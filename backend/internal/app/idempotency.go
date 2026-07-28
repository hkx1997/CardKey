package app

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/cardkey/cardkey/internal/domain"
	"github.com/cardkey/cardkey/internal/pkg/apperr"
)

const redeemIdempotencyTTL = 24 * time.Hour

// lookupRedeemIdempotency 若存在未过期记录则返回缓存结果。
func (a *App) lookupRedeemIdempotency(ctx context.Context, key, categorySlug, code string) (domain.RedeemResult, bool, error) {
	key = strings.TrimSpace(key)
	if key == "" || a.Pool == nil {
		return domain.RedeemResult{}, false, nil
	}
	if len(key) > 128 {
		return domain.RedeemResult{}, false, apperr.Validation("幂等键过长（最多 128）")
	}
	var raw []byte
	var cat, c string
	var created time.Time
	err := a.Pool.QueryRow(ctx, `
		SELECT category_slug, code, response, created_at
		FROM redeem_idempotency WHERE client_key=$1`, key).Scan(&cat, &c, &raw, &created)
	if err != nil {
		return domain.RedeemResult{}, false, nil // 不存在
	}
	if time.Since(created) > redeemIdempotencyTTL {
		_, _ = a.Pool.Exec(ctx, `DELETE FROM redeem_idempotency WHERE client_key=$1`, key)
		return domain.RedeemResult{}, false, nil
	}
	// 绑定 category+code，防止同 key 换码重放
	if cat != categorySlug || c != code {
		return domain.RedeemResult{}, false, apperr.Validation("幂等键已绑定其他兑换请求")
	}
	var res domain.RedeemResult
	if err := json.Unmarshal(raw, &res); err != nil {
		return domain.RedeemResult{}, false, nil
	}
	return res, true, nil
}

func (a *App) storeRedeemIdempotency(ctx context.Context, key, categorySlug, code string, res domain.RedeemResult) {
	key = strings.TrimSpace(key)
	if key == "" || a.Pool == nil {
		return
	}
	b, err := json.Marshal(res)
	if err != nil {
		return
	}
	_, _ = a.Pool.Exec(ctx, `
		INSERT INTO redeem_idempotency(client_key, category_slug, code, response)
		VALUES($1,$2,$3,$4::jsonb)
		ON CONFLICT (client_key) DO NOTHING`, key, categorySlug, code, string(b))
}
