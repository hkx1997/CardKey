package app

import (
	"context"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/cardkey/cardkey/internal/crypto"
	"github.com/cardkey/cardkey/internal/domain"
	"github.com/cardkey/cardkey/internal/pkg/apperr"
	"github.com/google/uuid"
)

// setupAdvisoryLockKey 进程/集群内串行化首次安装
const setupAdvisoryLockKey int64 = 0x434152444b455931 // "CARDKEY1"

type SetupStatus struct {
	NeedsSetup bool   `json:"needsSetup"`
	Ready      bool   `json:"ready"`
	SiteName   string `json:"siteName,omitempty"`
	Version    string `json:"version,omitempty"`
	Message    string `json:"message,omitempty"`
}

type SetupInput struct {
	Username           string `json:"username"`
	Password           string `json:"password"`
	ConfirmPassword    string `json:"confirmPassword"`
	SiteName           string `json:"siteName"`
	PublicRedeemAPIKey string `json:"publicRedeemApiKey"`
	// nil 时默认 true（安装演示类别）
	SeedDemoCategories *bool `json:"seedDemoCategories"`
}

// NeedsSetup 是否尚未创建任何管理员（首次安装向导）。
func (a *App) NeedsSetup(ctx context.Context) (bool, error) {
	var n int
	if err := a.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM admins`).Scan(&n); err != nil {
		return false, err
	}
	return n == 0, nil
}

func (a *App) GetSetupStatus(ctx context.Context) (SetupStatus, error) {
	needs, err := a.NeedsSetup(ctx)
	if err != nil {
		return SetupStatus{}, err
	}
	st := SetupStatus{
		NeedsSetup: needs,
		Ready:      true,
		Message:    "系统就绪",
	}
	if needs {
		st.Message = "请完成首次安装向导"
	}
	if s, err := a.GetSettings(ctx); err == nil {
		st.SiteName = s.SiteName
	}
	if err := a.Ready(ctx); err != nil {
		st.Ready = false
		st.Message = "数据库或 Redis 不可用"
	}
	return st, nil
}

// CompleteSetup 首次创建管理员；仅当 admins 表为空时可用。使用 advisory lock 防并发双开。
func (a *App) CompleteSetup(ctx context.Context, in SetupInput, ip string) (domain.AdminUser, string, error) {
	user := strings.TrimSpace(in.Username)
	pass := in.Password
	if user == "" {
		return domain.AdminUser{}, "", apperr.Validation("请填写管理员用户名")
	}
	if utf8.RuneCountInString(user) < 2 || utf8.RuneCountInString(user) > 32 {
		return domain.AdminUser{}, "", apperr.Validation("用户名长度 2–32 个字符")
	}
	if len(pass) < 8 {
		return domain.AdminUser{}, "", apperr.Validation("密码至少 8 位")
	}
	if in.ConfirmPassword != "" && pass != in.ConfirmPassword {
		return domain.AdminUser{}, "", apperr.Validation("两次密码不一致")
	}

	hash, err := crypto.HashPassword(pass)
	if err != nil {
		return domain.AdminUser{}, "", apperr.Internal("密码加密失败")
	}

	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return domain.AdminUser{}, "", err
	}
	defer tx.Rollback(ctx)

	// 串行化安装，避免双管理员竞态
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, setupAdvisoryLockKey); err != nil {
		return domain.AdminUser{}, "", err
	}

	var n int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM admins`).Scan(&n); err != nil {
		return domain.AdminUser{}, "", err
	}
	if n > 0 {
		return domain.AdminUser{}, "", apperr.Conflict("系统已完成初始化，请直接登录")
	}

	id := uuid.NewString()
	_, err = tx.Exec(ctx, `
		INSERT INTO admins(id, username, password_hash, must_change_password)
		VALUES($1,$2,$3,false)`, id, user, hash)
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			return domain.AdminUser{}, "", apperr.Conflict("用户名已存在")
		}
		return domain.AdminUser{}, "", err
	}

	// 站点名 / 兑换密钥（在锁内完成核心设置）
	s, _ := a.GetSettings(ctx)
	if sn := strings.TrimSpace(in.SiteName); sn != "" {
		s.SiteName = sn
		s.DocumentTitle = sn
		s.RedeemTitle = sn + " · 卡密兑换"
	}
	// 默认不在公开文档暴露密钥
	s.ExposePublicRedeemKeyInDocs = false
	if k := strings.TrimSpace(in.PublicRedeemAPIKey); k != "" {
		if len(k) < 16 {
			return domain.AdminUser{}, "", apperr.Validation("公开兑换密钥至少 16 位")
		}
		s.PublicRedeemApiKey = k
	} else if s.PublicRedeemApiKey == "" || s.PublicRedeemApiKey == "ck_redeem_demo_fixed_key_change_me" {
		plain, genErr := crypto.RandomAPIKey()
		if genErr != nil {
			return domain.AdminUser{}, "", apperr.Internal("生成兑换密钥失败")
		}
		s.PublicRedeemApiKey = plain
	}

	b, err := json.Marshal(s)
	if err != nil {
		return domain.AdminUser{}, "", err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO settings(key, value, updated_at) VALUES('all', $1::jsonb, now())
		ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, string(b))
	if err != nil {
		return domain.AdminUser{}, "", err
	}

	prefix := s.PublicRedeemApiKey
	if len(prefix) > 14 {
		prefix = prefix[:14]
	}
	var kn int
	_ = tx.QueryRow(ctx, `SELECT COUNT(*) FROM api_keys WHERE is_system_redeem_key`).Scan(&kn)
	if kn == 0 {
		_, err = tx.Exec(ctx, `
			INSERT INTO api_keys(name, key_prefix, key_hash, scopes, is_system_redeem_key, rate_limit_rpm)
			VALUES('系统兑换密钥', $1, $2, ARRAY['redeem:api'], true, 120)`,
			prefix, crypto.HashAPIKey(s.PublicRedeemApiKey))
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE api_keys SET key_prefix=$1, key_hash=$2, revoked_at=NULL
			WHERE is_system_redeem_key=true`, prefix, crypto.HashAPIKey(s.PublicRedeemApiKey))
	}
	if err != nil {
		return domain.AdminUser{}, "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.AdminUser{}, "", err
	}
	a.InvalidateSettingsCache()
	// 刷新缓存为刚保存的设置
	a.settingsMu.Lock()
	cp := s
	a.settingsCache = &cp
	a.settingsAt = time.Now()
	a.settingsMu.Unlock()

	// 演示类别：仅当安装向导显式勾选（seedDemoCategories=true）时写入；默认不种，避免生产误装示例
	seed := false
	if in.SeedDemoCategories != nil {
		seed = *in.SeedDemoCategories
	}
	if seed {
		var cn int
		_ = a.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM categories`).Scan(&cn)
		if cn == 0 {
			_ = a.seedDemo(ctx)
		}
	}

	a.Audit(ctx, "admin", user, "setup_complete", "system", "完成首次安装", ip)
	token, err := a.issueJWT(id, user)
	if err != nil {
		return domain.AdminUser{ID: id, Username: user, MustChangePassword: false}, "", nil
	}
	return domain.AdminUser{ID: id, Username: user, MustChangePassword: false}, token, nil
}
