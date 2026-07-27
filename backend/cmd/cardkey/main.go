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
	"github.com/redis/go-redis/v9"
)

func main() {
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

	migDir := findMigrations()
	if migDir == "" {
		log.Error("migrations dir not found")
		os.Exit(1)
	}
	if err := db.Migrate(ctx, pool, migDir); err != nil {
		log.Error("migrate failed", "err", err)
		os.Exit(1)
	}

	rdb := connectRedis(cfg.RedisURL, log)
	aesKey, err := crypto.NewAESKeyFromHex(cfg.ContentKeyHex)
	if err != nil {
		log.Error("content key invalid", "err", err)
		os.Exit(1)
	}
	if cfg.Env == "production" && cfg.ContentKeyHex == "" {
		log.Error("CONTENT_KEY required in production")
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
			"static", staticDir,
			"version", version.Version,
			"commit", version.Commit,
			"updateMode", cfg.UpdateMode,
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
