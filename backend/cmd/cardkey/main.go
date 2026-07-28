package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/cardkey/cardkey/internal/app"
	"github.com/cardkey/cardkey/internal/config"
	"github.com/cardkey/cardkey/internal/crypto"
	"github.com/cardkey/cardkey/internal/db"
	"github.com/cardkey/cardkey/internal/ratelimit"
	"github.com/cardkey/cardkey/internal/server"
	"github.com/cardkey/cardkey/internal/version"
	"github.com/cardkey/cardkey/internal/webstatic"
	"github.com/cardkey/cardkey/migrations"
	"github.com/redis/go-redis/v9"
)

// maybeExecPersistentBinary 若 DATA_DIR/bin/cardkey 存在且不是当前进程文件，则切换过去。
// 解决：compose recreate 后镜像仍是旧 ENTRYPOINT/旧 exe，一键更新写在数据卷上却跑不起来。
func maybeExecPersistentBinary() {
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "/app/data"
	}
	persist := filepath.Join(dataDir, "bin", "cardkey")
	st, err := os.Stat(persist)
	if err != nil || st.IsDir() || st.Size() < 1_000_000 {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	if resolved, e2 := filepath.EvalSymlinks(exe); e2 == nil {
		exe = resolved
	}
	if resolved, e2 := filepath.EvalSymlinks(persist); e2 == nil {
		persist = resolved
	}
	if filepath.Clean(exe) == filepath.Clean(persist) {
		return
	}
	// 已经是数据卷二进制则不再切换
	args := append([]string{persist}, os.Args[1:]...)
	_ = syscall.Exec(persist, args, os.Environ())
	// Exec 失败则继续用当前二进制
}

func main() {
	// Docker 一键更新：若数据卷上有更新后的二进制，优先切换执行（无需新镜像 entrypoint）
	maybeExecPersistentBinary()

	cfg := config.Load()
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(log)

	if err := cfg.ValidateProduction(); err != nil {
		log.Error("config invalid", "err", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	pool, err := db.ConnectWithPool(ctx, cfg.DatabaseURL, cfg.DBMaxConns, cfg.DBMinConns)
	if err != nil {
		log.Error("db connect failed", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	// 在线更新契约：SQL 经 go:embed 打进二进制 → 替换 exe 后重启自动 MigrateFS。
	// 磁盘 MIGRATIONS_DIR 仅作开发/额外补丁，不是 Docker 一键更新的依赖路径。
	migRes, err := db.MigrateFS(ctx, pool, migrations.FS)
	if err != nil {
		log.Error("migrate (embedded) failed", "err", err)
		os.Exit(1)
	}
	if migRes != nil {
		log.Info("db migrations (embedded)",
			"bundled", len(migRes.Bundled),
			"appliedNow", migRes.AppliedNow,
			"files", migRes.Bundled,
		)
	}
	if migDir := findMigrations(); migDir != "" {
		if diskRes, derr := db.Migrate(ctx, pool, migDir); derr != nil {
			log.Warn("migrate (disk) skipped/failed", "dir", migDir, "err", derr)
		} else if diskRes != nil && len(diskRes.AppliedNow) > 0 {
			log.Info("db migrations (disk extra)", "dir", migDir, "appliedNow", diskRes.AppliedNow)
		}
	}
	if err := db.EnsureSchemaHotfixes(ctx, pool); err != nil {
		log.Error("schema hotfix failed", "err", err)
		os.Exit(1)
	}

	rdb := connectRedis(cfg.RedisURL, log)
	if rdb == nil && cfg.RequireRedis {
		log.Error("redis required but unavailable (set REQUIRE_REDIS=false to override)")
		os.Exit(1)
	}
	aesKey, err := crypto.NewAESKeyFromHex(cfg.ContentKeyHex)
	if err != nil {
		log.Error("content key invalid", "err", err)
		os.Exit(1)
	}

	dataDir := getenv("DATA_DIR", "")
	if dataDir == "" {
		for _, c := range []string{"/app/data", "./data"} {
			if err := os.MkdirAll(c, 0o755); err == nil {
				dataDir = c
				break
			}
		}
	} else {
		_ = os.MkdirAll(dataDir, 0o755)
	}

	application := &app.App{
		Pool:                pool,
		RDB:                 rdb,
		Limiter:             ratelimit.New(rdb),
		AESKey:              aesKey,
		JWTSecret:           []byte(cfg.JWTSecret),
		Log:                 log,
		SecureCookie:        cfg.SecureCookie,
		TrustProxy:          cfg.TrustProxy,
		CSRFCheck:           cfg.CSRFCheck,
		Env:                 cfg.Env,
		RequireRedeemAPIKey: cfg.RequireRedeemAPIKey,
		MetricsToken:        cfg.MetricsToken,
		UpdateEnabled:       cfg.UpdateEnabled,
		UpdateMode:          cfg.UpdateMode,
		UpdateGitHubOwner:   cfg.UpdateGitHubOwner,
		UpdateGitHubRepo:    cfg.UpdateGitHubRepo,
		UpdateGitHubToken:   cfg.UpdateGitHubToken,
		UpdateReleasesDir:   cfg.UpdateReleasesDir,
		UpdateBinaryPath:    cfg.UpdateBinaryPath,
		UpdateKeepReleases:  cfg.UpdateKeepReleases,
		DataDir:             dataDir,
	}

	if _, _, err := application.Bootstrap(ctx, cfg.BootstrapUser, cfg.BootstrapPass, cfg.PublicRedeemKey); err != nil {
		log.Error("bootstrap failed", "err", err)
		os.Exit(1)
	}

	bg, bgCancel := context.WithCancel(context.Background())
	defer bgCancel()
	application.StartBackgroundJobs(bg)

	staticDir := cfg.StaticDir
	if staticDir == "" {
		for _, c := range []string{"/app/static", "frontend/dist", "../frontend/dist"} {
			if st, err := os.Stat(c); err == nil && st.IsDir() {
				staticDir = c
				break
			}
		}
	}
	// 一键更新后把嵌入 SPA 同步到磁盘，避免镜像层旧 /app/static 残留
	if webstatic.HasDist() && staticDir != "" {
		if n, err := webstatic.SyncToDir(staticDir); err != nil {
			log.Warn("sync embedded spa to disk failed", "dir", staticDir, "err", err)
		} else if n > 0 {
			log.Info("synced embedded spa to disk", "dir", staticDir, "files", n)
		}
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           server.New(application, cfg.CORSOrigins, staticDir),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       90 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	go func() {
		log.Info("cardkey listening",
			"addr", cfg.HTTPAddr,
			"staticDir", staticDir,
			"staticEmbedded", webstatic.HasDist(),
			"staticEmbeddedFiles", webstatic.AssetCount(),
			"version", version.Version,
			"commit", version.Commit,
			"updateMode", cfg.UpdateMode,
			"csrf", cfg.CSRFCheck,
			"trustProxy", cfg.TrustProxy,
		)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
	<-ch
	bgCancel()
	shctx, shcancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shcancel()
	_ = srv.Shutdown(shctx)
}

func findMigrations() string {
	if d := os.Getenv("MIGRATIONS_DIR"); d != "" {
		return d
	}
	candidates := []string{"migrations", "backend/migrations", filepath.Join("..", "migrations")}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && st.IsDir() {
			return c
		}
	}
	return ""
}

func connectRedis(url string, log *slog.Logger) *redis.Client {
	rdb, err := ratelimit.Connect(url)
	if err != nil {
		log.Warn("redis unavailable, rate limit disabled", "err", err)
		return nil
	}
	return rdb
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
