package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/cardkey/cardkey/internal/crypto"
	"github.com/cardkey/cardkey/internal/domain"
	"github.com/cardkey/cardkey/internal/pkg/apperr"
)

func (a *App) PublicConfig(ctx context.Context) (domain.PublicConfig, error) {
	s, err := a.GetSettings(ctx)
	if err != nil {
		return domain.PublicConfig{}, err
	}
	rows, err := a.Pool.Query(ctx, `
		SELECT slug, name, code_prefix, description, icon_kind, icon_value
		FROM categories WHERE enabled=true ORDER BY sort_order, created_at`)
	if err != nil {
		return domain.PublicConfig{}, err
	}
	defer rows.Close()
	cats := []domain.PublicCategory{}
	for rows.Next() {
		var c domain.PublicCategory
		if err := rows.Scan(&c.Slug, &c.Name, &c.CodePrefix, &c.Description, &c.Icon.Kind, &c.Icon.Value); err != nil {
			return domain.PublicConfig{}, err
		}
		cats = append(cats, c)
	}
	var logo, fav *string
	if s.SiteLogo != "" {
		logo = &s.SiteLogo
	}
	if s.SiteFavicon != "" {
		fav = &s.SiteFavicon
	}
	// 仅当「开放文档」且「文档展示固定密钥」同时开启时才下发密钥
	var pubKey *string
	if s.ApiDocsEnabled && s.ExposePublicRedeemKeyInDocs && s.PublicRedeemApiKey != "" {
		pubKey = &s.PublicRedeemApiKey
	}
	docTitle := strings.TrimSpace(s.DocumentTitle)
	if docTitle == "" {
		docTitle = s.SiteName
	}
	return domain.PublicConfig{
		SiteName: s.SiteName, SiteLogo: logo, SiteFavicon: fav, FooterText: s.FooterText,
		DocumentTitle: docTitle,
		RedeemTitle: s.RedeemTitle, RedeemSubtitle: s.RedeemSubtitle, RedeemSuccessHint: s.RedeemSuccessHint,
		RedeemPlaceholder: s.RedeemPlaceholder, RedeemButtonText: s.RedeemButtonText,
		CaptchaEnabled: s.CaptchaEnabled, RedeemTabVisibleCount: s.RedeemTabVisibleCount,
		ApiBasePath: s.ApiBasePath, ApiPublicBaseUrl: strings.TrimRight(s.ApiPublicBaseUrl, "/"),
		ApiDocsEnabled: s.ApiDocsEnabled,
		ShowApiDocsEntry: s.ApiDocsEnabled && s.ShowApiDocsEntry,
		PublicRedeemApiKey: pubKey, RateLimitIpPerMin: s.RateLimitIpPerMin, RateLimitCodePerMin: s.RateLimitCodePerMin,
		Categories: cats,
	}, nil
}

func (a *App) Redeem(ctx context.Context, categorySlug, code, ip, ua, apiKey string) (domain.RedeemResult, error) {
	s, err := a.GetSettings(ctx)
	if err != nil {
		return domain.RedeemResult{}, err
	}
	// 强制 API Key 或调用方携带了 Key 时均校验
	if a.RequireRedeemAPIKey || strings.TrimSpace(apiKey) != "" {
		if err := a.AuthenticateAPIKey(ctx, apiKey, "redeem:api"); err != nil {
			if a.RequireRedeemAPIKey || strings.TrimSpace(apiKey) != "" {
				return domain.RedeemResult{}, err
			}
		}
	}
	code = crypto.NormalizeCode(code)
	if code == "" {
		return domain.RedeemResult{}, apperr.Validation("请输入兑换编码")
	}
	// rate limit
	if a.Limiter != nil {
		okIP, errIP := a.Limiter.Allow(ctx, "redeem:ip:"+ip, s.RateLimitIpPerMin)
		okCode, errCode := a.Limiter.Allow(ctx, "redeem:code:"+code, s.RateLimitCodePerMin)
		if (errIP != nil || errCode != nil) && s.RateLimitFailClosed {
			return domain.RedeemResult{}, apperr.RateLimited("限流服务不可用")
		}
		if !okIP || !okCode {
			return domain.RedeemResult{}, apperr.RateLimited("请求过于频繁，请稍后再试")
		}
	}

	cat, err := a.FindCategoryBySlug(ctx, categorySlug)
	if err != nil || !cat.Enabled {
		return domain.RedeemResult{}, apperr.New(400, "CATEGORY_INVALID", "类别无效或已关闭")
	}

	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return domain.RedeemResult{}, err
	}
	defer tx.Rollback(ctx)

	var cardID string
	var typ domain.CardType
	var status domain.CardStatus
	var enc, nonce []byte
	var usedAt *time.Time
	var expiresAt *time.Time
	var cardCode string
	err = tx.QueryRow(ctx, `
		SELECT id, code, type, status, content_enc, content_nonce, used_at, expires_at
		FROM cards WHERE category_id=$1 AND code=$2 FOR UPDATE`, cat.ID, code).
		Scan(&cardID, &cardCode, &typ, &status, &enc, &nonce, &usedAt, &expiresAt)
	if err != nil {
		msg := "卡密不存在"
		if s.MaskCardErrors {
			msg = "卡密无效或不可用"
		}
		return domain.RedeemResult{}, apperr.New(404, "CARD_INVALID", msg)
	}
	// 懒过期：未标记但已过期的卡密即时转为 expired
	if status == domain.StatusUnused && expiresAt != nil && expiresAt.Before(time.Now().UTC()) {
		_, _ = tx.Exec(ctx, `UPDATE cards SET status='expired', updated_at=now() WHERE id=$1 AND status='unused'`, cardID)
		status = domain.StatusExpired
	}
	if status == domain.StatusDisabled {
		return domain.RedeemResult{}, apperr.New(403, "CARD_INVALID", "卡密无效或不可用")
	}
	if status == domain.StatusExpired {
		return domain.RedeemResult{}, apperr.New(410, "CARD_EXPIRED", "该卡密已过期")
	}
	plain, err := a.DecryptContent(enc, nonce)
	if err != nil {
		return domain.RedeemResult{}, apperr.Internal("解密失败")
	}
	if status == domain.StatusUsed {
		if !s.AllowRequery {
			return domain.RedeemResult{}, apperr.New(409, "CARD_USED", "该卡密已兑换")
		}
		ra := time.Now().UTC()
		if usedAt != nil {
			ra = *usedAt
		}
		return domain.RedeemResult{
			Status: "already_redeemed", Category: cat.Slug, CategoryName: cat.Name,
			Code: cardCode, Type: typ, Content: plain, RedeemedAt: formatTS(ra),
		}, nil
	}

	now := time.Now().UTC()
	tag, err := tx.Exec(ctx, `
		UPDATE cards SET status='used', used_at=$1, used_ip=NULLIF($2,'')::inet, updated_at=now(), version=version+1
		WHERE id=$3 AND status='unused'`, now, ip, cardID)
	if err != nil {
		return domain.RedeemResult{}, err
	}
	if tag.RowsAffected() != 1 {
		return domain.RedeemResult{}, apperr.New(409, "CARD_USED", "该卡密已兑换")
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO redeem_records(category_id, card_id, code, ip, user_agent, created_at)
		VALUES($1,$2,$3,NULLIF($4,'')::inet,$5,$6)`, cat.ID, cardID, cardCode, ip, ua, now)
	if err != nil {
		return domain.RedeemResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.RedeemResult{}, err
	}
	return domain.RedeemResult{
		Status: "success", Category: cat.Slug, CategoryName: cat.Name,
		Code: cardCode, Type: typ, Content: plain, RedeemedAt: formatTS(now),
	}, nil
}

func (a *App) ListRedeems(ctx context.Context, page, pageSize int, q, categorySlug string) (domain.PageResult[domain.RedeemRecord], error) {
	// inline to avoid import cycle risk; paging used via local normalize
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 10
	}
	where := "1=1"
	args := []any{}
	i := 1
	if q != "" {
		where += fmt.Sprintf(" AND (r.code ILIKE $%d OR r.ip::text ILIKE $%d)", i, i)
		args = append(args, "%"+q+"%")
		i++
	}
	if categorySlug != "" {
		where += fmt.Sprintf(" AND cat.slug=$%d", i)
		args = append(args, categorySlug)
		i++
	}
	var total int
	if err := a.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM redeem_records r
		JOIN categories cat ON cat.id=r.category_id WHERE `+where, args...).Scan(&total); err != nil {
		return domain.PageResult[domain.RedeemRecord]{}, err
	}
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := a.Pool.Query(ctx, fmt.Sprintf(`
		SELECT r.id, r.category_id, cat.slug, cat.name, r.card_id, r.code, COALESCE(r.ip::text,''), r.user_agent, r.created_at
		FROM redeem_records r
		JOIN categories cat ON cat.id=r.category_id
		WHERE %s
		ORDER BY r.created_at DESC
		LIMIT $%d OFFSET $%d`, where, i, i+1), args...)
	if err != nil {
		return domain.PageResult[domain.RedeemRecord]{}, err
	}
	defer rows.Close()
	items := []domain.RedeemRecord{}
	for rows.Next() {
		var r domain.RedeemRecord
		var created time.Time
		if err := rows.Scan(&r.ID, &r.CategoryID, &r.CategorySlug, &r.CategoryName, &r.CardID, &r.Code, &r.IP, &r.UserAgent, &created); err != nil {
			return domain.PageResult[domain.RedeemRecord]{}, err
		}
		r.CreatedAt = formatTS(created)
		items = append(items, r)
	}
	return domain.PageResult[domain.RedeemRecord]{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}
