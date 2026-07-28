package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/cardkey/cardkey/internal/pkg/apperr"
)

const captchaPassTTL = 3 * time.Minute

// CaptchaActive 设置开启且 Turnstile 双密钥齐全时，浏览器兑换必须过人机验证。
// 携带有效 redeem API Key 的脚本调用可跳过（避免破坏自动化）。
func (a *App) CaptchaActive(ctx context.Context) bool {
	if a.CaptchaSiteKey == "" || a.CaptchaSecretKey == "" {
		return false
	}
	s, err := a.GetSettings(ctx)
	if err != nil || !s.CaptchaEnabled {
		return false
	}
	return true
}

// VerifyTurnstile 校验 Cloudflare Turnstile token。
func (a *App) VerifyTurnstile(ctx context.Context, token, remoteIP string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return apperr.Validation("请完成人机验证")
	}
	if a.CaptchaSecretKey == "" {
		return apperr.Internal("验证码密钥未配置")
	}
	form := url.Values{}
	form.Set("secret", a.CaptchaSecretKey)
	form.Set("response", token)
	if remoteIP != "" {
		form.Set("remoteip", remoteIP)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://challenges.cloudflare.com/turnstile/v0/siteverify",
		strings.NewReader(form.Encode()))
	if err != nil {
		return apperr.Internal("验证码请求失败")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return apperr.Validation("人机验证服务暂不可用，请稍后重试")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return apperr.Validation("人机验证响应无效")
	}
	var out struct {
		Success bool     `json:"success"`
		Errors  []string `json:"error-codes"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return apperr.Validation("人机验证响应无效")
	}
	if !out.Success {
		return apperr.Validation("人机验证失败，请重试")
	}
	return nil
}

func captchaPassKey(ip string) string {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		ip = "unknown"
	}
	return fmt.Sprintf("cardkey:captcha_pass:%s", ip)
}

// RequireCaptchaForRedeem 浏览器兑换：开启验证码时校验 token。
// 校验成功后在 Redis 记 3 分钟放行（支持批量逐条兑换，token 单次有效）。
// apiKey 非空时跳过（脚本对接）。
func (a *App) RequireCaptchaForRedeem(ctx context.Context, captchaToken, ip, apiKey string) error {
	if strings.TrimSpace(apiKey) != "" {
		return nil
	}
	if !a.CaptchaActive(ctx) {
		return nil
	}
	// 短时已通过
	if a.RDB != nil {
		if n, err := a.RDB.Exists(ctx, captchaPassKey(ip)).Result(); err == nil && n > 0 {
			return nil
		}
	}
	if err := a.VerifyTurnstile(ctx, captchaToken, ip); err != nil {
		return err
	}
	if a.RDB != nil {
		_ = a.RDB.Set(ctx, captchaPassKey(ip), "1", captchaPassTTL).Err()
	}
	return nil
}
