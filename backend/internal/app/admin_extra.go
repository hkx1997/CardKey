package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/cardkey/cardkey/internal/crypto"
	"github.com/cardkey/cardkey/internal/domain"
	"github.com/cardkey/cardkey/internal/pkg/apperr"
	"github.com/google/uuid"
)

func (a *App) Dashboard(ctx context.Context) (domain.DashboardStats, error) {
	var s domain.DashboardStats

	// 卡密状态一次聚合
	_ = a.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE status='unused'),
			COUNT(*) FILTER (WHERE status='used'),
			COUNT(*) FILTER (WHERE status='disabled'),
			COUNT(*) FILTER (WHERE status='expired')
		FROM cards`).Scan(&s.TotalCards, &s.UnusedCards, &s.UsedCards, &s.DisabledCards, &s.ExpiredCards)

	// 兑换指标一次聚合
	_ = a.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE),
			COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE - 1),
			COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - 6)
		FROM redeem_records`).Scan(&s.TotalRedeems, &s.TodayRedeems, &s.YesterdayRedeems, &s.WeekRedeems)

	if s.TotalCards > 0 {
		s.RedeemRate = int(float64(s.UsedCards) / float64(s.TotalCards) * 100)
	}

	_ = a.Pool.QueryRow(ctx, `
		SELECT COUNT(*), COUNT(*) FILTER (WHERE enabled) FROM categories`).
		Scan(&s.TotalCategories, &s.EnabledCategories)
	_ = a.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM api_keys WHERE revoked_at IS NULL`).Scan(&s.ActiveApiKeys)

	// 14 天趋势：单次 group by，再补零
	counts := map[string]int{}
	trows, err := a.Pool.Query(ctx, `
		SELECT to_char(created_at::date, 'MM-DD') AS d, COUNT(*)
		FROM redeem_records
		WHERE created_at >= (CURRENT_DATE - 13)
		GROUP BY created_at::date
		ORDER BY created_at::date`)
	if err == nil {
		defer trows.Close()
		for trows.Next() {
			var d string
			var c int
			if trows.Scan(&d, &c) == nil {
				counts[d] = c
			}
		}
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

	// by category
	s.ByCategory = []struct {
		Slug       string              `json:"slug"`
		Name       string              `json:"name"`
		Icon       domain.CategoryIcon `json:"icon"`
		Unused     int                 `json:"unused"`
		Used       int                 `json:"used"`
		Total      int                 `json:"total"`
		RedeemRate int                 `json:"redeemRate"`
	}{}
	rows, err := a.Pool.Query(ctx, `
		SELECT cat.slug, cat.name, cat.icon_kind, cat.icon_value,
		       COUNT(c.id), COUNT(c.id) FILTER (WHERE c.status='unused'), COUNT(c.id) FILTER (WHERE c.status='used')
		FROM categories cat
		LEFT JOIN cards c ON c.category_id=cat.id
		GROUP BY cat.id ORDER BY cat.sort_order`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var slug, name, ik, iv string
			var total, unused, used int
			if rows.Scan(&slug, &name, &ik, &iv, &total, &unused, &used) != nil {
				continue
			}
			rate := 0
			if total > 0 {
				rate = int(float64(used) / float64(total) * 100)
			}
			s.ByCategory = append(s.ByCategory, struct {
				Slug       string              `json:"slug"`
				Name       string              `json:"name"`
				Icon       domain.CategoryIcon `json:"icon"`
				Unused     int                 `json:"unused"`
				Used       int                 `json:"used"`
				Total      int                 `json:"total"`
				RedeemRate int                 `json:"redeemRate"`
			}{Slug: slug, Name: name, Icon: domain.CategoryIcon{Kind: ik, Value: iv}, Unused: unused, Used: used, Total: total, RedeemRate: rate})
		}
	}

	rr, _ := a.ListRedeems(ctx, 1, 8, "", "")
	s.RecentRedeems = rr.Items
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
	_ = cur
	if err := a.SaveSettings(ctx, patch); err != nil {
		return domain.Settings{}, err
	}
	a.Audit(ctx, "admin", actor, "update_settings", "settings", "更新系统设置", ip)
	out, _ := a.GetSettings(ctx)
	return out, nil
}

func (a *App) ListAudit(ctx context.Context, page, pageSize int) (domain.PageResult[domain.AuditLog], error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	var total int
	_ = a.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM audit_logs`).Scan(&total)
	rows, err := a.Pool.Query(ctx, `
		SELECT id, actor_type, actor_label, action, resource, detail, COALESCE(ip::text,''), created_at
		FROM audit_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`, pageSize, (page-1)*pageSize)
	if err != nil {
		return domain.PageResult[domain.AuditLog]{}, err
	}
	defer rows.Close()
	items := []domain.AuditLog{}
	for rows.Next() {
		var l domain.AuditLog
		var created time.Time
		if err := rows.Scan(&l.ID, &l.ActorType, &l.ActorLabel, &l.Action, &l.Resource, &l.Detail, &l.IP, &created); err != nil {
			return domain.PageResult[domain.AuditLog]{}, err
		}
		l.CreatedAt = formatTS(created)
		items = append(items, l)
	}
	return domain.PageResult[domain.AuditLog]{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

// Ensure unused import used
var _ = fmt.Sprintf
