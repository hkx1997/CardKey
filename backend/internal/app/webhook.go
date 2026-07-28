package app

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/cardkey/cardkey/internal/domain"
)

// RedeemWebhookPayload 兑换成功回调体。
type RedeemWebhookPayload struct {
	Event        string `json:"event"`
	Category     string `json:"category"`
	CategoryName string `json:"categoryName"`
	Code         string `json:"code"`
	Type         string `json:"type"`
	RedeemedAt   string `json:"redeemedAt"`
	IP           string `json:"ip,omitempty"`
}

// SignWebhookBody 计算 X-CardKey-Signature 值（sha256=hex）。
func SignWebhookBody(secret string, body []byte) string {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// BuildRedeemWebhookPayloadJSON 构造投递 JSON（供测试与入队共用）。
func BuildRedeemWebhookPayloadJSON(res domain.RedeemResult, ip string) ([]byte, error) {
	payload := RedeemWebhookPayload{
		Event:        "redeem.success",
		Category:     res.Category,
		CategoryName: res.CategoryName,
		Code:         res.Code,
		Type:         string(res.Type),
		RedeemedAt:   res.RedeemedAt,
		IP:           ip,
	}
	return json.Marshal(payload)
}

// FireRedeemWebhook 入队可靠投递；无 URL 则跳过。失败不影响兑换结果。
func (a *App) FireRedeemWebhook(ctx context.Context, s domain.Settings, res domain.RedeemResult, ip string) {
	url := strings.TrimSpace(s.RedeemWebhookURL)
	if url == "" || !strings.HasPrefix(url, "http") {
		return
	}
	body, err := BuildRedeemWebhookPayloadJSON(res, ip)
	if err != nil {
		return
	}
	sig := SignWebhookBody(s.RedeemWebhookSecret, body)
	id, err := a.EnqueueWebhook(ctx, "redeem.success", url, body, sig)
	if err != nil {
		if a.Log != nil {
			a.Log.Warn("webhook enqueue failed", "err", err)
		}
		// 回退：尽力直接发送一次（表未迁移时仍可用）
		go a.deliverWebhookOnce(url, body, sig)
		return
	}
	// 立即尝试一次，其余由后台 job 重试
	go func() {
		cctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_, _ = a.ProcessWebhookOutboxByID(cctx, id)
	}()
}

// EnqueueWebhook 写入 outbox，返回 id。
// payload 以 TEXT 精确存储（禁止 JSONB 往返，否则 HMAC 与 POST body 不一致）。
func (a *App) EnqueueWebhook(ctx context.Context, event, targetURL string, payload []byte, signature string) (string, error) {
	if a.Pool == nil {
		return "", fmt.Errorf("no pool")
	}
	var id string
	err := a.Pool.QueryRow(ctx, `
		INSERT INTO webhook_outbox(event, target_url, payload, signature, status, next_attempt_at)
		VALUES($1,$2,$3,$4,'pending',now())
		RETURNING id::text`, event, targetURL, string(payload), signature).Scan(&id)
	return id, err
}

// WebhookDeliveryOutcome 单次处理结果（可观测）。
type WebhookDeliveryOutcome struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	Attempts   int    `json:"attempts"`
	LastError  string `json:"lastError,omitempty"`
	HTTPStatus int    `json:"httpStatus,omitempty"`
}

// ProcessWebhookOutboxByID 处理单条 outbox（供重试与测试）。
func (a *App) ProcessWebhookOutboxByID(ctx context.Context, id string) (WebhookDeliveryOutcome, error) {
	var target, payloadRaw, sig, status string
	var attempts, maxAttempts int
	err := a.Pool.QueryRow(ctx, `
		SELECT target_url, payload, signature, status, attempts, max_attempts
		FROM webhook_outbox WHERE id=$1::uuid`, id).Scan(
		&target, &payloadRaw, &sig, &status, &attempts, &maxAttempts)
	if err != nil {
		return WebhookDeliveryOutcome{}, err
	}
	out := WebhookDeliveryOutcome{ID: id, Status: status, Attempts: attempts}
	if status == "success" || status == "dead" {
		return out, nil
	}
	code, derr := a.postWebhook(ctx, target, []byte(payloadRaw), sig)
	out.HTTPStatus = code
	attempts++
	out.Attempts = attempts
	if derr == nil && code >= 200 && code < 300 {
		_, _ = a.Pool.Exec(ctx, `
			UPDATE webhook_outbox SET status='success', attempts=$2, last_error='', last_status_code=$3,
				updated_at=now() WHERE id=$1::uuid`, id, attempts, code)
		out.Status = "success"
		return out, nil
	}
	errMsg := ""
	if derr != nil {
		errMsg = derr.Error()
	} else {
		errMsg = fmt.Sprintf("http %d", code)
	}
	out.LastError = errMsg
	nextStatus := "failed"
	if attempts >= maxAttempts {
		nextStatus = "dead"
	}
	// 指数退避：2^attempts 秒，上限 5 分钟
	backoff := time.Duration(1<<min(attempts, 8)) * time.Second
	if backoff > 5*time.Minute {
		backoff = 5 * time.Minute
	}
	secs := int(backoff.Seconds())
	if secs < 1 {
		secs = 1
	}
	_, _ = a.Pool.Exec(ctx, `
		UPDATE webhook_outbox SET status=$2, attempts=$3, last_error=$4, last_status_code=$5,
			next_attempt_at=now() + make_interval(secs => $6), updated_at=now()
		WHERE id=$1::uuid`, id, nextStatus, attempts, errMsg, code, secs)
	out.Status = nextStatus
	return out, nil
}

// ProcessDueWebhooks 处理后台到期的失败/待投递条目，返回处理条数。
func (a *App) ProcessDueWebhooks(ctx context.Context, limit int) (int, error) {
	if limit < 1 {
		limit = 20
	}
	rows, err := a.Pool.Query(ctx, `
		SELECT id::text FROM webhook_outbox
		WHERE status IN ('pending','failed') AND next_attempt_at <= now()
		ORDER BY next_attempt_at
		LIMIT $1`, limit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return 0, err
		}
		ids = append(ids, id)
	}
	n := 0
	for _, id := range ids {
		if _, err := a.ProcessWebhookOutboxByID(ctx, id); err == nil {
			n++
		}
	}
	return n, nil
}

// GetWebhookOutbox 读取投递结果（可观测）。
func (a *App) GetWebhookOutbox(ctx context.Context, id string) (WebhookDeliveryOutcome, error) {
	var o WebhookDeliveryOutcome
	err := a.Pool.QueryRow(ctx, `
		SELECT id::text, status, attempts, last_error, last_status_code
		FROM webhook_outbox WHERE id=$1::uuid`, id).Scan(
		&o.ID, &o.Status, &o.Attempts, &o.LastError, &o.HTTPStatus)
	return o, err
}

func (a *App) postWebhook(ctx context.Context, url string, body []byte, signature string) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "CardKey-Webhook/1.0")
	if signature != "" {
		req.Header.Set("X-CardKey-Signature", signature)
	}
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	return resp.StatusCode, nil
}

func (a *App) deliverWebhookOnce(url string, body []byte, signature string) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	code, err := a.postWebhook(ctx, url, body, signature)
	if err != nil && a.Log != nil {
		a.Log.Warn("redeem webhook failed", "err", err, "url", url)
		return
	}
	if code >= 300 && a.Log != nil {
		a.Log.Warn("redeem webhook non-2xx", "status", code, "url", url)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
