package app

import (
	"context"
	"crypto/subtle"
	"strings"
	"time"

	"github.com/cardkey/cardkey/internal/crypto"
	"github.com/cardkey/cardkey/internal/pkg/apperr"
)

// APIKeyIdentity 鉴权成功后的密钥身份（用于审计与限流）
type APIKeyIdentity struct {
	ID     string
	Name   string
	Prefix string
	Scopes []string
}

// AuthenticateAPIKey 校验 Bearer API Key，需具备 needScope。
// admin:api 可覆盖一般管理 scope；system:update 仅 admin:api 或显式 system:update。
// 系统固定兑换密钥（settings.publicRedeemApiKey）始终视为 redeem:api。
func (a *App) AuthenticateAPIKey(ctx context.Context, plain string, needScope string) error {
	_, err := a.AuthenticateAPIKeyIdentity(ctx, plain, needScope)
	return err
}

// AuthenticateAPIKeyIdentity 同 AuthenticateAPIKey，并返回密钥元数据。
func (a *App) AuthenticateAPIKeyIdentity(ctx context.Context, plain string, needScope string) (*APIKeyIdentity, error) {
	plain = strings.TrimSpace(plain)
	if plain == "" {
		return nil, apperr.Unauthorized("需要 API Key")
	}
	// 系统固定密钥（明文比对，常量时间）
	s, err := a.GetSettings(ctx)
	if err == nil && s.PublicRedeemApiKey != "" {
		if subtle.ConstantTimeCompare([]byte(plain), []byte(s.PublicRedeemApiKey)) == 1 {
			if needScope == "" || needScope == "redeem:api" {
				return &APIKeyIdentity{
					ID:     "system-redeem",
					Name:   "系统兑换密钥",
					Prefix: prefixOf(plain),
					Scopes: []string{"redeem:api"},
				}, nil
			}
			return nil, apperr.Forbidden("系统兑换密钥仅具备 redeem:api 权限")
		}
	}

	peppered, legacy := crypto.APIKeyHashCandidates(plain, a.AESKey)
	var id, name, prefix string
	var scopes []string
	var revoked *time.Time
	var exp *time.Time
	var rpm *int
	var storedHash []byte
	err = a.Pool.QueryRow(ctx, `
		SELECT id, name, key_prefix, scopes, revoked_at, expires_at, rate_limit_rpm, key_hash
		FROM api_keys WHERE key_hash=$1 OR key_hash=$2
		LIMIT 1`, peppered, legacy).
		Scan(&id, &name, &prefix, &scopes, &revoked, &exp, &rpm, &storedHash)
	if err != nil {
		return nil, apperr.Unauthorized("API Key 无效")
	}
	if revoked != nil {
		return nil, apperr.Unauthorized("API Key 已吊销")
	}
	if exp != nil && exp.Before(time.Now().UTC()) {
		return nil, apperr.Unauthorized("API Key 已过期")
	}
	// 命中 legacy 时异步升级为 peppered hash
	if len(storedHash) > 0 && subtle.ConstantTimeCompare(storedHash, legacy) == 1 &&
		subtle.ConstantTimeCompare(peppered, legacy) != 1 {
		_, _ = a.Pool.Exec(ctx, `UPDATE api_keys SET key_hash=$1 WHERE id=$2`, peppered, id)
	}
	if needScope != "" {
		if !scopeAllows(scopes, needScope) {
			return nil, apperr.Forbidden("API Key 权限不足（需要 " + needScope + " 或更高权限）")
		}
	}
	// 按 key 限流
	if a.Limiter != nil && rpm != nil && *rpm > 0 {
		ok, errLim := a.Limiter.Allow(ctx, "apikey:"+id, *rpm)
		if errLim != nil && (a.Env == "production" || a.RateLimitFailClosed) {
			return nil, apperr.RateLimited("API Key 限流暂不可用")
		}
		if errLim == nil && !ok {
			return nil, apperr.RateLimited("API Key 请求过于频繁")
		}
	}
	// last_used_at 最多每 60s 写一次，避免高 RPS 写放大
	a.touchAPIKeyLastUsed(ctx, id)
	return &APIKeyIdentity{ID: id, Name: name, Prefix: prefix, Scopes: scopes}, nil
}

func (a *App) touchAPIKeyLastUsed(ctx context.Context, id string) {
	if id == "" || id == "system-redeem" {
		return
	}
	if a.RDB != nil {
		ok, err := a.RDB.SetNX(ctx, "apikey:touch:"+id, "1", 60*time.Second).Result()
		if err == nil && !ok {
			return
		}
	}
	_, _ = a.Pool.Exec(ctx, `UPDATE api_keys SET last_used_at=now() WHERE id=$1`, id)
}

// scopeAllows need 是否被 scopes 覆盖。
// admin:api → 全部管理能力含 system:update
// system:update → 仅更新相关
func scopeAllows(scopes []string, need string) bool {
	for _, sc := range scopes {
		if sc == need {
			return true
		}
		if sc == "admin:api" {
			return true
		}
	}
	return false
}

func prefixOf(plain string) string {
	if len(plain) > 14 {
		return plain[:14]
	}
	return plain
}
