package app

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/cardkey/cardkey/internal/crypto"
	"github.com/google/uuid"
)

// Bootstrap 初始化 settings、系统密钥、可选管理员。
// 若 pass 为空且尚无管理员：不创建管理员，留给 Web 首次安装向导。
// 若 pass 非空：创建管理员并打印凭证（自动化/脚本安装）。
// 绝不自动写入演示类别/卡密。
func (a *App) Bootstrap(ctx context.Context, user, pass, publicRedeemKey string) (adminUser, adminPass string, err error) {
	var n int
	if err := a.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM admins`).Scan(&n); err != nil {
		return "", "", err
	}
	if n == 0 && pass != "" {
		if user == "" {
			user = "admin"
		}
		hash, err := crypto.HashPassword(pass)
		if err != nil {
			return "", "", err
		}
		id := uuid.NewString()
		_, err = a.Pool.Exec(ctx, `
			INSERT INTO admins(id, username, password_hash, must_change_password)
			VALUES($1,$2,$3,true)`, id, user, hash)
		if err != nil {
			return "", "", err
		}
		adminUser, adminPass = user, pass
		// 不向 stdout 打印明文密码（日志采集易泄露）；仅提示用户名与改密要求
		a.Log.Info("bootstrap admin created from env", slog.String("username", user), slog.Bool("must_change_password", true))
		fmt.Printf("\n=== CardKey Bootstrap ===\nAdmin: %s\nPassword: (from BOOTSTRAP_ADMIN_PASS env, not printed)\n请立即登录并修改密码\n=========================\n\n", user)
	} else if n == 0 {
		a.Log.Info("no admin yet — complete setup wizard at /admin/setup")
		fmt.Printf("\n=== CardKey ===\n首次安装：打开管理端完成向导 /admin/setup\n===============\n\n")
	}

	// settings
	s, err := a.GetSettings(ctx)
	if err != nil {
		return adminUser, adminPass, err
	}
	var sc int
	_ = a.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM settings`).Scan(&sc)
	if sc == 0 {
		if publicRedeemKey != "" {
			s.PublicRedeemApiKey = publicRedeemKey
		}
		if err := a.SaveSettings(ctx, s); err != nil {
			return adminUser, adminPass, err
		}
	} else {
		s, _ = a.GetSettings(ctx)
	}

	// system redeem key row
	var kn int
	_ = a.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM api_keys WHERE is_system_redeem_key`).Scan(&kn)
	if kn == 0 {
		plain := s.PublicRedeemApiKey
		if plain == "" {
			plain = publicRedeemKey
		}
		if plain == "" {
			plain, _ = crypto.RandomAPIKey()
			s.PublicRedeemApiKey = plain
			_ = a.SaveSettings(ctx, s)
		}
		prefix := plain
		if len(prefix) > 14 {
			prefix = prefix[:14]
		}
		_, err = a.Pool.Exec(ctx, `
			INSERT INTO api_keys(name, key_prefix, key_hash, scopes, is_system_redeem_key, rate_limit_rpm)
			VALUES('系统兑换密钥', $1, $2, ARRAY['redeem:api'], true, 120)`,
			prefix, crypto.HashAPIKeyPeppered(plain, a.AESKey))
		if err != nil {
			return adminUser, adminPass, err
		}
	}

	// 绝不写入演示类别/卡密（安装向导与 Bootstrap 均不种示例数据）。
	var cn, an int
	_ = a.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM categories`).Scan(&cn)
	_ = a.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM admins`).Scan(&an)
	if a.Log != nil {
		a.Log.Info("db state",
			slog.Int("admins", an),
			slog.Int("categories", cn),
		)
		if an == 0 {
			a.Log.Warn("database has no admin — open /admin/setup (if unexpected: wrong/empty volume, see deploy/DATA_SAFETY.md)")
		}
	}
	return adminUser, adminPass, nil
}
