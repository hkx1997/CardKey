package app

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/cardkey/cardkey/internal/crypto"
	"github.com/google/uuid"
)

// Bootstrap 初始化 settings、系统密钥、可选管理员。
// 若 pass 为空且尚无管理员：不创建管理员，留给 Web 首次安装向导（对齐 sub2api）。
// 若 pass 非空：创建管理员并打印凭证（自动化/脚本安装）。
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

	// 绝不在启动时自动写入演示数据。
	// 演示类别/卡密仅在 Web 安装向导勾选 seedDemoCategories 时写入，
	// 避免「挂上新空卷 / 类别表为空」后每次重启又出现示例数据，看起来像被重置。
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

func (a *App) seedDemo(ctx context.Context) error {
	type seedCat struct {
		name, slug, prefix, desc, icon string
	}
	cats := []seedCat{
		{"会员卡", "vip", "VIP", "<p>会员权益兑换</p>", "ticket"},
		{"激活码", "cdk", "CDK", "<p>软件激活码</p>", "key-round"},
	}
	for i, c := range cats {
		var id string
		err := a.Pool.QueryRow(ctx, `
			INSERT INTO categories(name, slug, code_prefix, description, enabled, sort_order, icon_kind, icon_value)
			VALUES($1,$2,$3,$4,true,$5,'lucide',$6) RETURNING id`,
			c.name, c.slug, c.prefix, c.desc, i+1, c.icon).Scan(&id)
		if err != nil {
			return err
		}
		code := c.prefix + "-DEMO-7K3M-9P2X-W4QH"
		if c.slug == "cdk" {
			code = "CDK-DEMO-A2B3-C4D5-E6F7"
		}
		enc, nonce, err := a.EncryptContent("演示卡密内容 · " + c.name)
		if err != nil {
			return err
		}
		_, err = a.Pool.Exec(ctx, `
			INSERT INTO cards(category_id, code, content_enc, content_nonce, type, status, note)
			VALUES($1,$2,$3,$4,'text','unused','demo')`, id, code, enc, nonce)
		if err != nil {
			return err
		}
	}
	return nil
}
