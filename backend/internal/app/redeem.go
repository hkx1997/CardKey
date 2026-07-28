package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/cardkey/cardkey/internal/crypto"
	"github.com/cardkey/cardkey/internal/domain"
	"github.com/cardkey/cardkey/internal/pkg/apperr"
	"golang.org/x/sync/errgroup"
)

// availableStockExpr 可兑换库存：优先物化列，回退聚合
const availableStockExpr = `c.unused_count`

func (a *App) PublicConfig(ctx context.Context) (domain.PublicConfig, error) {
	const cacheKey = "cardkey:public_config_v2"
	if a.RDB != nil {
		if raw, err := a.RDB.Get(ctx, cacheKey).Bytes(); err == nil && len(raw) > 0 {
			var cached domain.PublicConfig
			if json.Unmarshal(raw, &cached) == nil {
				return cached, nil
			}
		}
	}
	s, err := a.GetSettings(ctx)
	if err != nil {
		return domain.PublicConfig{}, err
	}
	// 配置接口不再全表聚合库存（由 /category-stock 轮询承担），避免冷启动双倍扫表
	// 大 data URL 图标截断，降低首包体积
	rows, err := a.Pool.Query(ctx, `
		SELECT c.slug, c.name, c.code_prefix, c.description, c.icon_kind,
		       CASE WHEN c.icon_kind='image' AND length(c.icon_value) > 4096 THEN '' ELSE c.icon_value END
		FROM categories c
		WHERE c.enabled = true
		ORDER BY c.sort_order, c.created_at`)
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
		// -1 表示「未携带库存，请用 stock 接口」；前端首屏用 stock 覆盖
		c.UnusedCount = -1
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
	cfg := domain.PublicConfig{
		SiteName: s.SiteName, SiteLogo: logo, SiteFavicon: fav, FooterText: s.FooterText,
		DocumentTitle: docTitle,
		RedeemTitle: s.RedeemTitle, RedeemSubtitle: s.RedeemSubtitle, RedeemSuccessHint: s.RedeemSuccessHint,
		RedeemPlaceholder: s.RedeemPlaceholder, RedeemButtonText: s.RedeemButtonText,
		// 仅当设置开启且环境配齐 Turnstile 密钥时，才对前端宣称已保护
		CaptchaEnabled: a.CaptchaActive(ctx), RedeemTabVisibleCount: s.RedeemTabVisibleCount,
		CaptchaSiteKey: func() string {
			if a.CaptchaActive(ctx) {
				return a.CaptchaSiteKey
			}
			return ""
		}(),
		ApiBasePath: s.ApiBasePath, ApiPublicBaseUrl: strings.TrimRight(s.ApiPublicBaseUrl, "/"),
		ApiDocsEnabled: s.ApiDocsEnabled,
		ShowApiDocsEntry: s.ApiDocsEnabled && s.ShowApiDocsEntry,
		PublicRedeemApiKey: pubKey, RateLimitIpPerMin: s.RateLimitIpPerMin, RateLimitCodePerMin: s.RateLimitCodePerMin,
		Categories: cats,
	}
	if a.RDB != nil {
		if b, err := json.Marshal(cfg); err == nil {
			_ = a.RDB.Set(ctx, cacheKey, b, 20*time.Second).Err()
		}
	}
	return cfg, nil
}

// PublicCategoryStock 启用类别的可兑换库存快照（供兑换端轮询，轻量无 HTML）。
// Redis 短缓存 3s，减轻 10s 轮询 + 多实例重复聚合压力。
func (a *App) PublicCategoryStock(ctx context.Context) (domain.PublicStock, error) {
	const cacheKey = "cardkey:public_stock_v1"
	if a.RDB != nil {
		if raw, err := a.RDB.Get(ctx, cacheKey).Bytes(); err == nil && len(raw) > 0 {
			var cached domain.PublicStock
			if json.Unmarshal(raw, &cached) == nil && len(cached.Categories) >= 0 {
				return cached, nil
			}
		}
	}
	rows, err := a.Pool.Query(ctx, `
		SELECT c.slug, COALESCE(c.unused_count, 0)
		FROM categories c
		WHERE c.enabled = true
		ORDER BY c.sort_order, c.created_at`)
	if err != nil {
		return domain.PublicStock{}, err
	}
	defer rows.Close()
	out := []domain.PublicCategoryStock{}
	for rows.Next() {
		var s domain.PublicCategoryStock
		if err := rows.Scan(&s.Slug, &s.UnusedCount); err != nil {
			return domain.PublicStock{}, err
		}
		out = append(out, s)
	}
	if out == nil {
		out = []domain.PublicCategoryStock{}
	}
	stock := domain.PublicStock{
		Categories: out,
		UpdatedAt:  formatTS(time.Now().UTC()),
	}
	if a.RDB != nil {
		if b, err := json.Marshal(stock); err == nil {
			_ = a.RDB.Set(ctx, cacheKey, b, 8*time.Second).Err()
		}
	}
	return stock, nil
}

// PublicStockETag 基于库存内容生成弱 ETag（不依赖时钟），供 304 协商。
func PublicStockETag(s domain.PublicStock) string {
	h := sha256.New()
	for _, c := range s.Categories {
		_, _ = fmt.Fprintf(h, "%s:%d\n", c.Slug, c.UnusedCount)
	}
	sum := hex.EncodeToString(h.Sum(nil)[:16])
	return `W/"` + sum + `"`
}

// Redeem 公开兑换。idempotencyKey 非空时，相同 key+类别+码 在 TTL 内返回同一成功结果且不二次消耗。
func (a *App) Redeem(ctx context.Context, categorySlug, code, ip, ua, apiKey string, captchaToken string) (domain.RedeemResult, error) {
	return a.RedeemWithIdempotency(ctx, categorySlug, code, ip, ua, apiKey, captchaToken, "")
}

// RedeemWithIdempotency 带幂等键的兑换（handler 传入 header/body 中的 key）。
func (a *App) RedeemWithIdempotency(ctx context.Context, categorySlug, code, ip, ua, apiKey, captchaToken, idempotencyKey string) (domain.RedeemResult, error) {
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
	// 浏览器兑换：Turnstile（API Key 调用跳过）
	if err := a.RequireCaptchaForRedeem(ctx, captchaToken, ip, apiKey); err != nil {
		return domain.RedeemResult{}, err
	}
	code = crypto.NormalizeCode(code)
	if code == "" {
		return domain.RedeemResult{}, apperr.Validation("请输入兑换编码")
	}
	categorySlug = strings.TrimSpace(categorySlug)

	// 幂等命中：直接返回，不重复扣库存
	if cached, ok, err := a.lookupRedeemIdempotency(ctx, idempotencyKey, categorySlug, code); err != nil {
		return domain.RedeemResult{}, err
	} else if ok {
		return cached, nil
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
	var filename, mime string
	var size int64
	var storageKey, storageBackend string
	err = tx.QueryRow(ctx, `
		SELECT id, code, type, status, content_enc, content_nonce, used_at, expires_at,
		       COALESCE(content_filename,''), COALESCE(content_mime,''), COALESCE(content_size,0),
		       COALESCE(storage_key,''), COALESCE(storage_backend,'')
		FROM cards WHERE category_id=$1 AND code=$2 FOR UPDATE`, cat.ID, code).
		Scan(&cardID, &cardCode, &typ, &status, &enc, &nonce, &usedAt, &expiresAt, &filename, &mime, &size,
			&storageKey, &storageBackend)
	if err != nil {
		msg := "卡密不存在"
		if s.MaskCardErrors {
			msg = "卡密无效或不可用"
		}
		return domain.RedeemResult{}, apperr.New(404, "CARD_INVALID", msg)
	}
	// 懒过期：未标记但已过期的卡密即时转为 expired（须 Commit 后再改物化库存，避免 defer Rollback 丢状态却已 -1）
	lazyExpired := false
	if status == domain.StatusUnused && expiresAt != nil && expiresAt.Before(time.Now().UTC()) {
		tag, e := tx.Exec(ctx, `UPDATE cards SET status='expired', updated_at=now() WHERE id=$1 AND status='unused'`, cardID)
		if e != nil {
			return domain.RedeemResult{}, e
		}
		if tag.RowsAffected() == 1 {
			lazyExpired = true
		}
		status = domain.StatusExpired
	}
	switch domain.EvaluateRedeemStatus(status) {
	case domain.RedeemDisabled:
		return domain.RedeemResult{}, apperr.New(403, "CARD_INVALID", "卡密无效或不可用")
	case domain.RedeemExpired:
		if lazyExpired {
			if err := tx.Commit(ctx); err != nil {
				return domain.RedeemResult{}, err
			}
			a.bumpCardStats(ctx, cat.ID, 0, 0, -1)
		}
		return domain.RedeemResult{}, apperr.New(410, "CARD_EXPIRED", "该卡密已过期")
	case domain.RedeemNotUnused:
		return domain.RedeemResult{}, apperr.New(403, "CARD_INVALID", "卡密无效或不可用")
	}

	// 已兑且不允许再查：不解密
	if status == domain.StatusUsed && !s.AllowRequery {
		return domain.RedeemResult{}, apperr.New(409, "CARD_USED", "该卡密已兑换")
	}

	// 确认可返回内容后再解密（缩短 FOR UPDATE 锁内无效路径）
	raw, err := a.DecryptBytes(enc, nonce)
	if err != nil {
		return domain.RedeemResult{}, apperr.Internal("解密失败")
	}
	if storageBackend == "local" && storageKey != "" {
		if obj, e := a.LoadObject(storageKey); e == nil {
			raw = obj
		}
	}
	filename, mime, size = fillContentMeta(typ, filename, mime, size)
	if size == 0 {
		size = int64(len(raw))
	}
	content, encoding := packPayloadForAPI(typ, raw, filename, mime, size)

	if status == domain.StatusUsed {
		// AllowRequery：释放锁后返回
		_ = tx.Rollback(ctx)
		ra := time.Now().UTC()
		if usedAt != nil {
			ra = *usedAt
		}
		return domain.RedeemResult{
			Status: "already_redeemed", Category: cat.Slug, CategoryName: cat.Name,
			Code: cardCode, Type: typ, Content: content, ContentEncoding: encoding,
			Filename: filename, Mime: mime, Size: size, RedeemedAt: formatTS(ra),
		}, nil
	}

	now := time.Now().UTC()
	// 事务内扣库存，减少漂移与对账压力
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
		UPDATE categories SET
			unused_count = GREATEST(0, unused_count - 1),
			used_count = used_count + 1,
			updated_at = now()
		WHERE id=$1::uuid`, cat.ID)
	if err != nil {
		return domain.RedeemResult{}, err
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
	a.invalidateStockCaches(ctx)
	result := domain.RedeemResult{
		Status: "success", Category: cat.Slug, CategoryName: cat.Name,
		Code: cardCode, Type: typ, Content: content, ContentEncoding: encoding,
		Filename: filename, Mime: mime, Size: size, RedeemedAt: formatTS(now),
	}
	a.storeRedeemIdempotency(ctx, idempotencyKey, cat.Slug, cardCode, result)
	// 可靠 Webhook 入队
	a.FireRedeemWebhook(ctx, s, result, ip)
	return result, nil
}

func (a *App) ListRedeems(ctx context.Context, page, pageSize int, q, categorySlug, cursor string) (domain.PageResult[domain.RedeemRecord], error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 10
	}
	whereParts := []string{"1=1"}
	args := []any{}
	i := 1
	if q != "" {
		if len(q) >= 3 {
			whereParts = append(whereParts, fmt.Sprintf("(r.code ILIKE $%d OR host(r.ip) ILIKE $%d)", i, i))
		} else {
			whereParts = append(whereParts, fmt.Sprintf("r.code ILIKE $%d", i))
		}
		args = append(args, "%"+q+"%")
		i++
	}
	needCat := categorySlug != ""
	if needCat {
		whereParts = append(whereParts, fmt.Sprintf("cat.slug=$%d", i))
		args = append(args, categorySlug)
		i++
	}
	useKeyset := false
	if cur, ok := decodeListCursor(cursor); ok {
		frag, cargs := keysetPredicate("r", cur, i)
		whereParts = append(whereParts, frag)
		args = append(args, cargs...)
		i += len(cargs)
		useKeyset = true
	}
	where := strings.Join(whereParts, " AND ")

	// COUNT 条件不含 keyset
	countWhere := "1=1"
	countArgs := []any{}
	ci := 1
	if q != "" {
		if len(q) >= 3 {
			countWhere += fmt.Sprintf(" AND (r.code ILIKE $%d OR host(r.ip) ILIKE $%d)", ci, ci)
		} else {
			countWhere += fmt.Sprintf(" AND r.code ILIKE $%d", ci)
		}
		countArgs = append(countArgs, "%"+q+"%")
		ci++
	}
	if needCat {
		countWhere += fmt.Sprintf(" AND cat.slug=$%d", ci)
		countArgs = append(countArgs, categorySlug)
	}

	fetchN := pageSize + 1
	var listArgs []any
	if useKeyset {
		listArgs = append(append([]any{}, args...), fetchN)
	} else {
		listArgs = append(append([]any{}, args...), fetchN, (page-1)*pageSize)
	}

	unfiltered := q == "" && categorySlug == ""
	var total int
	totalExact := true
	var items []domain.RedeemRecord
	var times []time.Time
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		n, exact, err := a.smartCount(gctx, "redeem_records", filterKey(q, categorySlug), unfiltered, 5000, func() (int, error) {
			var countSQL string
			if needCat {
				countSQL = `SELECT COUNT(*) FROM redeem_records r JOIN categories cat ON cat.id=r.category_id WHERE ` + countWhere
			} else if q != "" {
				countSQL = `SELECT COUNT(*) FROM redeem_records r WHERE ` + countWhere
			} else {
				countSQL = `SELECT COUNT(*) FROM redeem_records`
			}
			var n int
			err := a.Pool.QueryRow(gctx, countSQL, countArgs...).Scan(&n)
			return n, err
		})
		if err != nil {
			return err
		}
		total, totalExact = n, exact
		return nil
	})
	g.Go(func() error {
		var sql string
		if useKeyset {
			sql = fmt.Sprintf(`
				SELECT r.id, r.category_id, cat.slug, cat.name, r.card_id, r.code, COALESCE(r.ip::text,''), r.user_agent, r.created_at
				FROM redeem_records r
				JOIN categories cat ON cat.id=r.category_id
				WHERE %s
				ORDER BY r.created_at DESC, r.id DESC
				LIMIT $%d`, where, i)
		} else {
			sql = fmt.Sprintf(`
				SELECT r.id, r.category_id, cat.slug, cat.name, r.card_id, r.code, COALESCE(r.ip::text,''), r.user_agent, r.created_at
				FROM redeem_records r
				JOIN categories cat ON cat.id=r.category_id
				WHERE %s
				ORDER BY r.created_at DESC, r.id DESC
				LIMIT $%d OFFSET $%d`, where, i, i+1)
		}
		rows, err := a.Pool.Query(gctx, sql, listArgs...)
		if err != nil {
			return err
		}
		defer rows.Close()
		out := []domain.RedeemRecord{}
		ts := []time.Time{}
		for rows.Next() {
			var r domain.RedeemRecord
			var created time.Time
			if err := rows.Scan(&r.ID, &r.CategoryID, &r.CategorySlug, &r.CategoryName, &r.CardID, &r.Code, &r.IP, &r.UserAgent, &created); err != nil {
				return err
			}
			r.CreatedAt = formatTS(created)
			out = append(out, r)
			ts = append(ts, created)
		}
		items = out
		times = ts
		return nil
	})
	if err := g.Wait(); err != nil {
		return domain.PageResult[domain.RedeemRecord]{}, err
	}
	if items == nil {
		items = []domain.RedeemRecord{}
	}
	hasMore := len(items) > pageSize
	if hasMore {
		items = items[:pageSize]
		times = times[:pageSize]
	}
	next := ""
	if hasMore && len(items) > 0 {
		next = encodeListCursor(times[len(times)-1], items[len(items)-1].ID)
	}
	return domain.PageResult[domain.RedeemRecord]{
		Items: items, Total: total, Page: page, PageSize: pageSize,
		TotalExact: totalExact, HasMore: hasMore, NextCursor: next,
	}, nil
}
