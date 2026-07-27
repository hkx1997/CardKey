package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	HTTPAddr        string
	DatabaseURL     string
	RedisURL        string
	JWTSecret       string
	ContentKeyHex   string
	BootstrapUser   string
	BootstrapPass   string
	PublicRedeemKey string
	CORSOrigins     []string
	StaticDir       string
	Env             string
	SecureCookie    bool
	TrustProxy      bool
	DBMaxConns      int32
	DBMinConns      int32

	// 兑换是否强制 API Key
	RequireRedeemAPIKey bool
	// 管理端写操作 CSRF：校验 Origin/Referer 同源（浏览器 Cookie 场景）
	CSRFCheck bool

	// 在线更新
	UpdateEnabled      bool
	UpdateMode         string // binary | docker | disabled
	UpdateGitHubOwner  string
	UpdateGitHubRepo   string
	UpdateGitHubToken  string
	UpdateReleasesDir  string
	UpdateBinaryPath   string
	UpdateKeepReleases int
}

func Load() Config {
	env := getenv("APP_ENV", "development")
	prod := env == "production"
	secure := strings.EqualFold(getenv("SECURE_COOKIE", ""), "true")
	trust := !strings.EqualFold(getenv("TRUST_PROXY", "true"), "false")
	csrfDefault := "true"
	if !prod {
		csrfDefault = "false"
	}
	updateMode := getenv("UPDATE_MODE", "")
	if updateMode == "" {
		if getenv("UPDATE_ENABLED", "") == "true" {
			updateMode = "binary"
		} else {
			updateMode = "disabled"
		}
	}
	return Config{
		HTTPAddr:        getenv("HTTP_ADDR", ":8080"),
		DatabaseURL:     getenv("DATABASE_URL", "postgres://cardkey:cardkey@localhost:5432/cardkey?sslmode=disable"),
		RedisURL:        getenv("REDIS_URL", "redis://localhost:6379/0"),
		JWTSecret:       getenv("JWT_SECRET", "dev-jwt-secret-change-me-in-production-32b"),
		ContentKeyHex:   getenv("CONTENT_KEY", ""),
		BootstrapUser:   getenv("BOOTSTRAP_ADMIN_USER", "admin"),
		BootstrapPass:   getenv("BOOTSTRAP_ADMIN_PASS", ""),
		PublicRedeemKey: getenv("PUBLIC_REDEEM_API_KEY", "ck_redeem_demo_fixed_key_change_me"),
		CORSOrigins: splitCSV(getenv("CORS_ORIGINS",
			"http://localhost:5173,http://127.0.0.1:5173,http://localhost:18080,http://127.0.0.1:18080")),
		StaticDir:           getenv("STATIC_DIR", ""),
		Env:                 env,
		SecureCookie:        secure,
		TrustProxy:          trust,
		DBMaxConns:          int32(EnvInt("DB_MAX_CONNS", 20)),
		DBMinConns:          int32(EnvInt("DB_MIN_CONNS", 2)),
		RequireRedeemAPIKey: strings.EqualFold(getenv("REQUIRE_REDEEM_API_KEY", "false"), "true"),
		CSRFCheck:           strings.EqualFold(getenv("CSRF_CHECK", csrfDefault), "true"),
		UpdateEnabled:       updateMode != "disabled" && updateMode != "",
		UpdateMode:          updateMode,
		UpdateGitHubOwner:   getenv("UPDATE_GITHUB_OWNER", ""),
		UpdateGitHubRepo:    getenv("UPDATE_GITHUB_REPO", ""),
		UpdateGitHubToken:   getenv("UPDATE_GITHUB_TOKEN", ""),
		UpdateReleasesDir:   getenv("UPDATE_RELEASES_DIR", "/opt/cardkey/releases"),
		UpdateBinaryPath:    getenv("UPDATE_BINARY_PATH", "/opt/cardkey/cardkey"),
		UpdateKeepReleases:  EnvInt("UPDATE_KEEP_RELEASES", 5),
	}
}

// ValidateProduction 生产环境强校验，避免空密钥/弱配置。
func (c Config) ValidateProduction() error {
	if c.Env != "production" {
		return nil
	}
	if len(c.JWTSecret) < 32 || strings.Contains(c.JWTSecret, "change-me") {
		return errf("production requires strong JWT_SECRET (>=32 chars, not default)")
	}
	if c.ContentKeyHex == "" {
		return errf("production requires CONTENT_KEY (64 hex chars = 32 bytes AES)")
	}
	if len(c.ContentKeyHex) != 64 {
		return errf("CONTENT_KEY must be 64 hex characters")
	}
	return nil
}

type simpleErr string

func (e simpleErr) Error() string { return string(e) }
func errf(s string) error         { return simpleErr(s) }

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func EnvInt(k string, def int) int {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}
