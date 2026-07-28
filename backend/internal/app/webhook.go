package app

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/cardkey/cardkey/internal/domain"
)

// RedeemWebhookPayload 兑换成功异步回调体。
type RedeemWebhookPayload struct {
	Event        string `json:"event"`
	Category     string `json:"category"`
	CategoryName string `json:"categoryName"`
	Code         string `json:"code"`
	Type         string `json:"type"`
	RedeemedAt   string `json:"redeemedAt"`
	IP           string `json:"ip,omitempty"`
}

// FireRedeemWebhook 非阻塞发送；失败只打日志不影响兑换结果。
func (a *App) FireRedeemWebhook(ctx context.Context, s domain.Settings, res domain.RedeemResult, ip string) {
	url := strings.TrimSpace(s.RedeemWebhookURL)
	if url == "" || !strings.HasPrefix(url, "http") {
		return
	}
	payload := RedeemWebhookPayload{
		Event:        "redeem.success",
		Category:     res.Category,
		CategoryName: res.CategoryName,
		Code:         res.Code,
		Type:         string(res.Type),
		RedeemedAt:   res.RedeemedAt,
		IP:           ip,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return
	}
	secret := strings.TrimSpace(s.RedeemWebhookSecret)
	go func() {
		wctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(wctx, http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "CardKey-Webhook/1.0")
		if secret != "" {
			mac := hmac.New(sha256.New, []byte(secret))
			_, _ = mac.Write(body)
			req.Header.Set("X-CardKey-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			if a.Log != nil {
				a.Log.Warn("redeem webhook failed", "err", err, "url", url)
			}
			return
		}
		_ = resp.Body.Close()
		if resp.StatusCode >= 300 && a.Log != nil {
			a.Log.Warn("redeem webhook non-2xx", "status", resp.StatusCode, "url", url)
		}
	}()
}
