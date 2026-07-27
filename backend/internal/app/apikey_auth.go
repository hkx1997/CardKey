package app

import (
	"context"
	"crypto/subtle"
	"strings"
	"time"

	"github.com/cardkey/cardkey/internal/crypto"
	"github.com/cardkey/cardkey/internal/pkg/apperr"
)

// AuthenticateAPIKey 校验 Bearer API Key，返回是否具备指定 scope。
// 系统固定兑换密钥（settings.publicRedeemApiKey）始终视为 redeem:api。
func (a *App) AuthenticateAPIKey(ctx context.Context, plain string, needScope string) error {
	plain = strings.TrimSpace(plain)
	if plain == "" {
		return apperr.Unauthorized("需要 API Key")
	}
	// 系统固定密钥（明文比对，常量时间）
	s, err := a.GetSettings(ctx)
	if err == nil && s.PublicRedeemApiKey != "" {
		if subtle.ConstantTimeCompare([]byte(plain), []byte(s.PublicRedeemApiKey)) == 1 {
			if needScope == "" || needScope == "redeem:api" {
				return nil
			}
		}
	}
	hash := crypto.HashAPIKey(plain)
	var id string
	var scopes []string
	var revoked *time.Time
	var exp *time.Time
	var rpm *int
	err = a.Pool.QueryRow(ctx, `
		SELECT id, scopes, revoked_at, expires_at, rate_limit_rpm
		FROM api_keys WHERE key_hash=$1`, hash).
		Scan(&id, &scopes, &revoked, &exp, &rpm)
	if err != nil {
		return apperr.Unauthorized("API Key 无效")
	}
	if revoked != nil {
		return apperr.Unauthorized("API Key 已吊销")
	}
	if exp != nil && exp.Before(time.Now().UTC()) {
		return apperr.Unauthorized("API Key 已过期")
	}
	if needScope != "" {
		ok := false
		for _, sc := range scopes {
			if sc == needScope || sc == "admin:api" {
				ok = true
				break
			}
		}
		if !ok {
			return apperr.Forbidden("API Key 权限不足")
		}
	}
	// 按 key 限流
	if a.Limiter != nil && rpm != nil && *rpm > 0 {
		ok, _ := a.Limiter.Allow(ctx, "apikey:"+id, *rpm)
		if !ok {
			return apperr.RateLimited("API Key 请求过于频繁")
		}
	}
	_, _ = a.Pool.Exec(ctx, `UPDATE api_keys SET last_used_at=now() WHERE id=$1`, id)
	return nil
}
