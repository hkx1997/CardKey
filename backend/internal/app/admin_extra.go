package app

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/cardkey/cardkey/internal/crypto"
	"github.com/cardkey/cardkey/internal/domain"
	"github.com/cardkey/cardkey/internal/pkg/apperr"
	"github.com/google/uuid"
	"golang.org/x/sync/errgroup"
)

// 看板短缓存：多查询聚合，12s 内复用（写操作后最多 12s 滞后）
var (
	dashCacheMu   sync.Mutex
	dashCacheAt   time.Time
	dashCacheData domain.DashboardStats
	dashCacheOK   bool
)

const dashCacheTTL = 20 * time.Second

func (a *App) InvalidateDashboardCache() {
	dashCacheMu.Lock()
	dashCacheOK = false
	dashCacheMu.Unlock()
}

func (a *App) Dashboard(ctx context.Context) (domain.DashboardStats, error) {
	dashCacheMu.Lock()
	if dashCacheOK && time.Since(dashCacheAt) < dashCacheTTL {
		s := dashCacheData
		dashCacheMu.Unlock()
		return s, nil
	}
	dashCacheMu.Unlock()

	s, err := a.dashboardCompute(ctx)
	if err != nil {
		return s, err
	}
	dashCacheMu.Lock()
	dashCacheData = s
	dashCacheAt = time.Now()
	dashCacheOK = true
	dashCacheMu.Unlock()
	return s, nil
}

func (a *App) dashboardCompute(ctx context.Context) (domain.DashboardStats, error) {
	type byCat = struct {
		Slug       string              `json:"slug"`
		Name       string              `json:"name"`
		Icon       domain.CategoryIcon `json:"icon"`
		Unused     int                 `json:"unused"`
		Used       int                 `json:"used"`
		Total      int                 `json:"total"`
		RedeemRate int                 `json:"redeemRate"`
	}

	var (
		totalCards, unusedCards, usedCards, disabledCards, expiredCards int
		totalRedeems, todayRedeems, yesterdayRedeems, weekRedeems       int
		totalCategories, enabledCategories, activeAPIKeys               int
		counts                                                          = map[string]int{}
		byCategory                                                      []byCat
		recent                                                          []domain.RedeemRecord
	)

	var g errgroup.Group
	g.Go(func() error {
		// 卡密状态：Redis 20s 缓存 + 单次 GROUP BY（一次扫表）
		m, err := a.cardStatusCountsCached(ctx)
		if err != nil {
			return err
		}
		unusedCards = m["unused"]
		usedCards = m["used"]
		disabledCards = m["disabled"]
		expiredCards = m["expired"]
		totalCards = unusedCards + usedCards + disabledCards + expiredCards
		// 无数据时 total 可能为 0；大表估算兜底
		if totalCards == 0 {
			if est, ok := a.tableRowEstimate(ctx, "cards"); ok && est > 0 {
				totalCards = est
			}
		}
		return nil
	})
	g.Go(func() error {
		// 兑换：今日/昨日/周用区间（可走索引）；总量大表用估算 + 缓存
		var err error
		totalRedeems, _, err = a.smartCount(ctx, "redeem_records", "all", true, 3000, func() (int, error) {
			var n int
			e := a.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM redeem_records`).Scan(&n)
			return n, e
		})
		if err != nil {
			return err
		}
		return a.Pool.QueryRow(ctx, `
			SELECT
				COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + 1),
				COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - 1 AND created_at < CURRENT_DATE),
				COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - 6)
			FROM redeem_records
			WHERE created_at >= CURRENT_DATE - 6`).Scan(&todayRedeems, &yesterdayRedeems, &weekRedeems)
	})
	g.Go(func() error {
		_ = a.Pool.QueryRow(ctx, `
			SELECT COUNT(*), COUNT(*) FILTER (WHERE enabled) FROM categories`).
			Scan(&totalCategories, &enabledCategories)
		_ = a.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM api_keys WHERE revoked_at IS NULL`).Scan(&activeAPIKeys)
		return nil
	})
	g.Go(func() error {
		trows, err := a.Pool.Query(ctx, `
			SELECT to_char(date_trunc('day', created_at), 'MM-DD') AS d, COUNT(*)
			FROM redeem_records
			WHERE created_at >= CURRENT_DATE - 13
			GROUP BY date_trunc('day', created_at)
			ORDER BY date_trunc('day', created_at)`)
		if err != nil {
			return nil
		}
		defer trows.Close()
		local := map[string]int{}
		for trows.Next() {
			var d string
			var c int
			if trows.Scan(&d, &c) == nil {
				local[d] = c
			}
		}
		counts = local
		return nil
	})
	g.Go(func() error {
		// 仅物化列，零扫 cards
		rows, err := a.Pool.Query(ctx, `
			SELECT cat.slug, cat.name, cat.icon_kind, cat.icon_value,
			       COALESCE(cat.unused_count, 0),
			       COALESCE(cat.used_count, 0),
			       COALESCE(cat.card_count, 0)
			FROM categories cat
			ORDER BY cat.sort_order`)
		if err != nil {
			return nil
		}
		defer rows.Close()
		var list []byCat
		for rows.Next() {
			var slug, name, ik, iv string
			var unused, used, total int
			if rows.Scan(&slug, &name, &ik, &iv, &unused, &used, &total) != nil {
				continue
			}
			rate := 0
			if total > 0 {
				rate = int(float64(used) / float64(total) * 100)
			}
			list = append(list, byCat{
				Slug: slug, Name: name, Icon: domain.CategoryIcon{Kind: ik, Value: iv},
				Unused: unused, Used: used, Total: total, RedeemRate: rate,
			})
		}
		byCategory = list
		return nil
	})
	g.Go(func() error {
		recent = a.listRecentRedeems(ctx, 8)
		return nil
	})
	_ = g.Wait()

	s := domain.DashboardStats{
		TotalCards: totalCards, UnusedCards: unusedCards, UsedCards: usedCards,
		DisabledCards: disabledCards, ExpiredCards: expiredCards,
		TotalRedeems: totalRedeems, TodayRedeems: todayRedeems,
		YesterdayRedeems: yesterdayRedeems, WeekRedeems: weekRedeems,
		TotalCategories: totalCategories, EnabledCategories: enabledCategories,
		ActiveApiKeys: activeAPIKeys,
		RecentRedeems: recent,
	}
	if s.TotalCards > 0 {
		s.RedeemRate = int(float64(s.UsedCards) / float64(s.TotalCards) * 100)
	}
	s.ByCategory = make([]struct {
		Slug       string              `json:"slug"`
		Name       string              `json:"name"`
		Icon       domain.CategoryIcon `json:"icon"`
		Unused     int                 `json:"unused"`
		Used       int                 `json:"used"`
		Total      int                 `json:"total"`
		RedeemRate int                 `json:"redeemRate"`
	}, 0, len(byCategory))
	for _, bc := range byCategory {
		s.ByCategory = append(s.ByCategory, struct {
			Slug       string              `json:"slug"`
			Name       string              `json:"name"`
			Icon       domain.CategoryIcon `json:"icon"`
			Unused     int                 `json:"unused"`
			Used       int                 `json:"used"`
			Total      int                 `json:"total"`
			RedeemRate int                 `json:"redeemRate"`
		}{Slug: bc.Slug, Name: bc.Name, Icon: bc.Icon, Unused: bc.Unused, Used: bc.Used, Total: bc.Total, RedeemRate: bc.RedeemRate})
	}
	s.Trend = make([]struct {
		Date  string `json:"date"`
		Count int    `json:"count"`
	}, 0, 14)
	for d := 13; d >= 0; d-- {
		day := time.Now().AddDate(0, 0, -d)
		key := day.Format("01-02")
		s.Trend = append(s.Trend, struct {
			Date  string `json:"date"`
			Count int    `json:"count"`
		}{Date: key, Count: counts[key]})
	}
	if s.RecentRedeems == nil {
		s.RecentRedeems = []domain.RedeemRecord{}
	}
	s.StatusBreakdown = []struct {
		Status domain.CardStatus `json:"status"`
		Count  int               `json:"count"`
	}{
		{Status: domain.StatusUnused, Count: s.UnusedCards},
		{Status: domain.StatusUsed, Count: s.UsedCards},
		{Status: domain.StatusDisabled, Count: s.DisabledCards},
		{Status: domain.StatusExpired, Count: s.ExpiredCards},
	}
	return s, nil
}

// listRecentRedeems 仅最近 N 条，跳过 COUNT 全表。
func (a *App) listRecentRedeems(ctx context.Context, limit int) []domain.RedeemRecord {
	if limit < 1 {
		limit = 8
	}
	rows, err := a.Pool.Query(ctx, `
		SELECT r.id, r.category_id, cat.slug, cat.name, r.card_id, r.code, COALESCE(r.ip::text,''), r.user_agent, r.created_at
		FROM redeem_records r
		JOIN categories cat ON cat.id=r.category_id
		ORDER BY r.created_at DESC
		LIMIT $1`, limit)
	if err != nil {
		return []domain.RedeemRecord{}
	}
	defer rows.Close()
	items := []domain.RedeemRecord{}
	for rows.Next() {
		var r domain.RedeemRecord
		var created time.Time
		if err := rows.Scan(&r.ID, &r.CategoryID, &r.CategorySlug, &r.CategoryName, &r.CardID, &r.Code, &r.IP, &r.UserAgent, &created); err != nil {
			continue
		}
		r.CreatedAt = formatTS(created)
		items = append(items, r)
	}
	return items
}

func (a *App) ListAPIKeys(ctx context.Context) ([]domain.ApiKeyMeta, error) {
	s, _ := a.GetSettings(ctx)
	rows, err := a.Pool.Query(ctx, `
		SELECT id, name, key_prefix, scopes, is_system_redeem_key, rate_limit_rpm, expires_at, revoked_at, last_used_at, created_at
		FROM api_keys ORDER BY is_system_redeem_key DESC, created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.ApiKeyMeta{}
	for rows.Next() {
		var k domain.ApiKeyMeta
		var scopes []string
		var exp, rev, last *time.Time
		var created time.Time
		var rpm *int
		if err := rows.Scan(&k.ID, &k.Name, &k.KeyPrefix, &scopes, &k.IsSystemRedeemKey, &rpm, &exp, &rev, &last, &created); err != nil {
			return nil, err
		}
		k.Scopes = scopes
		if k.Scopes == nil {
			k.Scopes = []string{}
		}
		k.RateLimitRpm = rpm
		k.ExpiresAt = domain.PtrTime(exp)
		k.RevokedAt = domain.PtrTime(rev)
		k.LastUsedAt = domain.PtrTime(last)
		k.CreatedAt = formatTS(created)
		if k.IsSystemRedeemKey {
			sec := s.PublicRedeemApiKey
			k.Secret = &sec
		}
		out = append(out, k)
	}
	return out, nil
}

func (a *App) CreateAPIKey(ctx context.Context, name string, scopes []string, rpm *int, actor, ip string) (domain.ApiKeyMeta, string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(scopes) == 0 {
		return domain.ApiKeyMeta{}, "", apperr.Validation("名称与权限必填")
	}
	plain, err := crypto.RandomAPIKey()
	if err != nil {
		return domain.ApiKeyMeta{}, "", err
	}
	prefix := plain
	if len(prefix) > 14 {
		prefix = prefix[:14]
	}
	id := uuid.NewString()
	var created time.Time
	err = a.Pool.QueryRow(ctx, `
		INSERT INTO api_keys(id, name, key_prefix, key_hash, scopes, rate_limit_rpm)
		VALUES($1,$2,$3,$4,$5,$6) RETURNING created_at`,
		id, name, prefix, crypto.HashAPIKeyPeppered(plain, a.AESKey), scopes, rpm).Scan(&created)
	if err != nil {
		return domain.ApiKeyMeta{}, "", err
	}
	a.Audit(ctx, "admin", actor, "create_api_key", "api_key:"+id, name, ip)
	meta := domain.ApiKeyMeta{
		ID: id, Name: name, KeyPrefix: prefix, Scopes: scopes, Secret: &plain,
		RateLimitRpm: rpm, CreatedAt: formatTS(created),
	}
	return meta, plain, nil
}

func (a *App) RevokeAPIKey(ctx context.Context, id, actor, ip string) error {
	var sys bool
	var name string
	err := a.Pool.QueryRow(ctx, `SELECT is_system_redeem_key, name FROM api_keys WHERE id=$1`, id).Scan(&sys, &name)
	if err != nil {
		return apperr.NotFound("密钥不存在")
	}
	if sys {
		return apperr.Validation("系统固定密钥请使用轮换接口")
	}
	tag, err := a.Pool.Exec(ctx, `UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.Validation("密钥已吊销或不存在")
	}
	a.Audit(ctx, "admin", actor, "revoke_api_key", "api_key:"+id, name, ip)
	return nil
}

// DeleteAPIKey 永久删除自定义密钥（系统固定密钥不可删）。
// 已吊销或仍有效的密钥均可硬删除，便于清理。
func (a *App) DeleteAPIKey(ctx context.Context, id, actor, ip string) error {
	var sys bool
	var name string
	err := a.Pool.QueryRow(ctx, `SELECT is_system_redeem_key, name FROM api_keys WHERE id=$1`, id).Scan(&sys, &name)
	if err != nil {
		return apperr.NotFound("密钥不存在")
	}
	if sys {
		return apperr.Validation("系统固定密钥不可删除，请使用轮换")
	}
	tag, err := a.Pool.Exec(ctx, `DELETE FROM api_keys WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return apperr.NotFound("密钥不存在")
	}
	a.Audit(ctx, "admin", actor, "delete_api_key", "api_key:"+id, name, ip)
	return nil
}

func (a *App) RotateAPIKey(ctx context.Context, id, actor, ip string) (domain.ApiKeyMeta, string, error) {
	var sys bool
	var name string
	err := a.Pool.QueryRow(ctx, `SELECT is_system_redeem_key, name FROM api_keys WHERE id=$1`, id).Scan(&sys, &name)
	if err != nil {
		return domain.ApiKeyMeta{}, "", apperr.NotFound("密钥不存在")
	}
	if sys {
		return domain.ApiKeyMeta{}, "", apperr.Validation("请使用固定兑换密钥的轮换接口")
	}
	plain, err := crypto.RandomAPIKey()
	if err != nil {
		return domain.ApiKeyMeta{}, "", err
	}
	prefix := plain
	if len(prefix) > 14 {
		prefix = prefix[:14]
	}
	_, err = a.Pool.Exec(ctx, `
		UPDATE api_keys SET key_prefix=$1, key_hash=$2, revoked_at=NULL WHERE id=$3`,
		prefix, crypto.HashAPIKeyPeppered(plain, a.AESKey), id)
	if err != nil {
		return domain.ApiKeyMeta{}, "", err
	}
	a.Audit(ctx, "admin", actor, "rotate_api_key", "api_key:"+id, name, ip)
	meta := domain.ApiKeyMeta{ID: id, Name: name, KeyPrefix: prefix, Secret: &plain, CreatedAt: formatTS(time.Now())}
	return meta, plain, nil
}

func (a *App) SetPublicRedeemKey(ctx context.Context, mode, custom, actor, ip string) (string, error) {
	s, err := a.GetSettings(ctx)
	if err != nil {
		return "", err
	}
	var plain string
	if mode == "custom" {
		plain = strings.TrimSpace(custom)
		if len(plain) < 16 {
			return "", apperr.Validation("密钥至少 16 位")
		}
	} else {
		plain, err = crypto.RandomAPIKey()
		if err != nil {
			return "", err
		}
	}
	s.PublicRedeemApiKey = plain
	if err := a.SaveSettings(ctx, s); err != nil {
		return "", err
	}
	prefix := plain
	if len(prefix) > 14 {
		prefix = prefix[:14]
	}
	_, err = a.Pool.Exec(ctx, `
		UPDATE api_keys SET key_prefix=$1, key_hash=$2, revoked_at=NULL
		WHERE is_system_redeem_key=true`, prefix, crypto.HashAPIKeyPeppered(plain, a.AESKey))
	if err != nil {
		return "", err
	}
	a.Audit(ctx, "admin", actor, "set_public_redeem_key", "settings", mode, ip)
	return plain, nil
}

func (a *App) UpdateSettings(ctx context.Context, patch domain.Settings, actor, ip string) (domain.Settings, error) {
	// full replace from client form
	if patch.RedeemTabVisibleCount < 1 {
		patch.RedeemTabVisibleCount = 1
	}
	if patch.ApiBasePath == "" {
		patch.ApiBasePath = "/api/v1"
	}
	patch.ApiPublicBaseUrl = strings.TrimRight(strings.TrimSpace(patch.ApiPublicBaseUrl), "/")
	if patch.SmtpPort <= 0 {
		patch.SmtpPort = 587
	}
	if patch.MailAlertCooldownMinutes < 5 {
		patch.MailAlertCooldownMinutes = 60
	}
	if patch.MailHealthErrorRatePct < 0 {
		patch.MailHealthErrorRatePct = 0
	}
	if patch.MailCardUnusedThreshold < 0 {
		patch.MailCardUnusedThreshold = 0
	}
	if patch.MailCardAlertCategoryIds == nil {
		patch.MailCardAlertCategoryIds = []string{}
	} else {
		// 去空、去重
		seen := map[string]struct{}{}
		clean := make([]string, 0, len(patch.MailCardAlertCategoryIds))
		for _, id := range patch.MailCardAlertCategoryIds {
			id = strings.TrimSpace(id)
			if id == "" {
				continue
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			clean = append(clean, id)
		}
		patch.MailCardAlertCategoryIds = clean
	}
	// preserve secrets if empty in patch
	cur, _ := a.loadSettings(ctx) // 含密码明文（load 后再 mask 的是 GetSettings）
	// loadSettings already masks - need raw password from DB
	rawCur, _ := a.loadSettingsRaw(ctx)
	if patch.PublicRedeemApiKey == "" {
		patch.PublicRedeemApiKey = rawCur.PublicRedeemApiKey
	}
	if strings.TrimSpace(patch.SmtpPassword) == "" {
		patch.SmtpPassword = rawCur.SmtpPassword
	}
	// Webhook 密钥空串保留原值（与 SMTP 密码同策略）
	if strings.TrimSpace(patch.RedeemWebhookSecret) == "" {
		patch.RedeemWebhookSecret = rawCur.RedeemWebhookSecret
	}
	patch.RedeemWebhookURL = strings.TrimSpace(patch.RedeemWebhookURL)
	_ = cur
	if err := a.SaveSettings(ctx, patch); err != nil {
		return domain.Settings{}, err
	}
	a.Audit(ctx, "admin", actor, "update_settings", "settings", "更新系统设置", ip)
	out, _ := a.GetSettings(ctx)
	return out, nil
}

func (a *App) ListAudit(ctx context.Context, page, pageSize int, cursor string) (domain.PageResult[domain.AuditLog], error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	useKeyset := false
	where := "1=1"
	args := []any{}
	i := 1
	if cur, ok := decodeListCursor(cursor); ok {
		frag, cargs := keysetPredicate("audit_logs", cur, i)
		// keysetPredicate uses prefix.created_at — table name as prefix works for bare table
		where = frag
		args = append(args, cargs...)
		i += len(cargs)
		useKeyset = true
		_ = cur
	}
	fetchN := pageSize + 1
	var listArgs []any
	if useKeyset {
		listArgs = append(append([]any{}, args...), fetchN)
	} else {
		listArgs = []any{fetchN, (page - 1) * pageSize}
	}

	var total int
	totalExact := true
	var items []domain.AuditLog
	var times []time.Time
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		n, exact, err := a.smartCount(gctx, "audit_logs", "all", true, 5000, func() (int, error) {
			var n int
			e := a.Pool.QueryRow(gctx, `SELECT COUNT(*) FROM audit_logs`).Scan(&n)
			return n, e
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
				SELECT id, actor_type, actor_label, action, resource, detail, COALESCE(ip::text,''), created_at
				FROM audit_logs WHERE %s
				ORDER BY created_at DESC, id DESC LIMIT $%d`, where, i)
		} else {
			sql = `
				SELECT id, actor_type, actor_label, action, resource, detail, COALESCE(ip::text,''), created_at
				FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`
		}
		rows, err := a.Pool.Query(gctx, sql, listArgs...)
		if err != nil {
			return err
		}
		defer rows.Close()
		out := []domain.AuditLog{}
		ts := []time.Time{}
		for rows.Next() {
			var l domain.AuditLog
			var created time.Time
			if err := rows.Scan(&l.ID, &l.ActorType, &l.ActorLabel, &l.Action, &l.Resource, &l.Detail, &l.IP, &created); err != nil {
				return err
			}
			l.CreatedAt = formatTS(created)
			out = append(out, l)
			ts = append(ts, created)
		}
		items = out
		times = ts
		return nil
	})
	if err := g.Wait(); err != nil {
		return domain.PageResult[domain.AuditLog]{}, err
	}
	if items == nil {
		items = []domain.AuditLog{}
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
	return domain.PageResult[domain.AuditLog]{
		Items: items, Total: total, Page: page, PageSize: pageSize,
		TotalExact: totalExact, HasMore: hasMore, NextCursor: next,
	}, nil
}

// cardStatusCountsCached 卡密按状态计数，Redis 20s。
func (a *App) cardStatusCountsCached(ctx context.Context) (map[string]int, error) {
	const key = "cardkey:card_status_counts_v1"
	if a.RDB != nil {
		if raw, err := a.RDB.Get(ctx, key).Bytes(); err == nil && len(raw) > 0 {
			// format: unused=1,used=2,...
			m := map[string]int{"unused": 0, "used": 0, "disabled": 0, "expired": 0}
			for _, part := range strings.Split(string(raw), ",") {
				kv := strings.SplitN(part, "=", 2)
				if len(kv) == 2 {
					if n, e := strconv.Atoi(kv[1]); e == nil {
						m[kv[0]] = n
					}
				}
			}
			return m, nil
		}
	}
	rows, err := a.Pool.Query(ctx, `SELECT status::text, COUNT(*)::int FROM cards GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[string]int{"unused": 0, "used": 0, "disabled": 0, "expired": 0}
	for rows.Next() {
		var st string
		var n int
		if rows.Scan(&st, &n) == nil {
			m[st] = n
		}
	}
	if a.RDB != nil {
		parts := make([]string, 0, 4)
		for _, k := range []string{"unused", "used", "disabled", "expired"} {
			parts = append(parts, fmt.Sprintf("%s=%d", k, m[k]))
		}
		_ = a.RDB.Set(ctx, key, strings.Join(parts, ","), 20*time.Second).Err()
	}
	return m, nil
}

// Ensure unused import used
var _ = fmt.Sprintf
