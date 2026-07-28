package app

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/cardkey/cardkey/internal/crypto"
	"github.com/cardkey/cardkey/internal/db"
	"github.com/cardkey/cardkey/migrations"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// testDBURL 优先 CARDKEY_TEST_DATABASE_URL，其次专用测试端口 25432，再次 DATABASE_URL。
func testDBURL() string {
	if v := os.Getenv("CARDKEY_TEST_DATABASE_URL"); v != "" {
		return v
	}
	// docker run -p 25432:5432 postgres（run_integ_tests.py 使用）
	if v := os.Getenv("CARDKEY_TEST_PG_PORT"); v != "" {
		return "postgres://cardkey:cardkey@127.0.0.1:" + v + "/cardkey?sslmode=disable"
	}
	return "postgres://cardkey:cardkey@127.0.0.1:25432/cardkey?sslmode=disable"
}

// openTestApp 连接真实 PG、跑迁移，构造可调用 Redeem/BatchAction 的 App。
// 不可用时 t.Skip（但 go test 套件仍会跑纯单元测）；集成套件通过 TestMain 尽量拉起 PG。
func openTestApp(t *testing.T) (*App, func()) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	url := testDBURL()
	pool, err := db.ConnectWithPool(ctx, url, 8, 1)
	if err != nil {
		// 集成测是目标验收的一部分：无库则失败（TestMain 会尝试 docker 拉起）
		t.Fatalf("postgres unavailable (%v); start cardkey-test-pg on :25432 or set CARDKEY_TEST_DATABASE_URL", err)
	}
	if _, err := db.MigrateFS(ctx, pool, migrations.FS); err != nil {
		pool.Close()
		t.Fatalf("migrate: %v", err)
	}
	// 测试用 AES key（32 bytes）
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 1)
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	a := &App{
		Pool:       pool,
		AESKey:     key,
		JWTSecret:  []byte("test-jwt-secret-at-least-32-bytes-long!!"),
		Log:        log,
		CSRFCheck:  true,
		Env:        "test",
		SecureCookie: false,
	}
	// 确保 settings 行存在；测试关闭错误掩码便于断言
	ds := a.DefaultSettings()
	ds.MaskCardErrors = false
	ds.AllowRequery = true
	ds.RateLimitIpPerMin = 100000
	ds.RateLimitCodePerMin = 100000
	if err := a.SaveSettings(ctx, ds); err != nil {
		pool.Close()
		t.Fatalf("settings: %v", err)
	}
	cleanup := func() {
		pool.Close()
	}
	return a, cleanup
}

type seedCard struct {
	Slug   string
	Code   string
	CardID string
	CatID  string
}

func seedRedeemable(t *testing.T, a *App, content string) seedCard {
	t.Helper()
	ctx := context.Background()
	u := strings.ToUpper(strings.ReplaceAll(uuid.NewString()[:8], "-", ""))
	slug := "t-" + strings.ToLower(u)
	// prefix max 16; keep short unique
	prefix := "T" + u[:4]
	// store code already uppercased (matches crypto.NormalizeCode)
	code := prefix + "-CODE-" + u

	var catID string
	err := a.Pool.QueryRow(ctx, `
		INSERT INTO categories(name, slug, code_prefix, description, enabled, sort_order)
		VALUES($1,$2,$3,'test',true,0) RETURNING id::text`,
		"Cat "+u, slug, prefix).Scan(&catID)
	if err != nil {
		t.Fatalf("category: %v", err)
	}
	enc, nonce, err := crypto.Encrypt(a.AESKey, []byte(content))
	if err != nil {
		t.Fatal(err)
	}
	var cardID string
	err = a.Pool.QueryRow(ctx, `
		INSERT INTO cards(category_id, code, content_enc, content_nonce, type, status)
		VALUES($1::uuid,$2,$3,$4,'text','unused') RETURNING id::text`,
		catID, code, enc, nonce).Scan(&cardID)
	if err != nil {
		t.Fatalf("card: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = a.Pool.Exec(c, `DELETE FROM redeem_idempotency WHERE code=$1`, code)
		_, _ = a.Pool.Exec(c, `DELETE FROM redeem_records WHERE card_id=$1::uuid`, cardID)
		_, _ = a.Pool.Exec(c, `DELETE FROM cards WHERE category_id=$1::uuid`, catID)
		_, _ = a.Pool.Exec(c, `DELETE FROM categories WHERE id=$1::uuid`, catID)
	})
	return seedCard{Slug: slug, Code: code, CardID: cardID, CatID: catID}
}

// mustPool 用于确认集成测真的用了 pool（防 stub）。
func mustPool(t *testing.T, a *App) *pgxpool.Pool {
	t.Helper()
	if a == nil || a.Pool == nil {
		t.Fatal("nil pool")
	}
	return a.Pool
}
