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
	// 生产环境是否要求 Redis 可用（限流 / JWT 吊销）
	RequireRedis bool
	// /metrics 访问令牌；空则生产禁用、开发放行
	MetricsToken string

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

// 已知不安全默认值（生产禁止）
var (
	deniedJWTSubstr = []string{
		"change-me",
		"please-rotate",
		"local-dev",
		"dev-jwt-secret",
		"cardkey-local",
	}
	// 文档/compose 示例 CONTENT_KEY（全 0-f 重复）
	deniedContentKeys = map[string]bool{
		"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef": true,
	}
)

func Load() Config {
	env := getenv("APP_ENV", "development")
	prod := env == "production"

	// SecureCookie：显式 true/false，否则生产默认 true、开发 false
	secure := !prod
	if v := getenv("SECURE_COOKIE", ""); v != "" {
		secure = strings.EqualFold(v, "true")
	}

	// TrustProxy：生产默认 true（通常在反代后）；开发默认 false 防伪造 IP
	trustDefault := "false"
	if prod {
		trustDefault = "true"
	}
	trust := strings.EqualFold(getenv("TRUST_PROXY", trustDefault), "true")

	// CSRF：默认开启（含生产与开发中管理写操作）
	csrfDefault := "true"
	csrf := strings.EqualFold(getenv("CSRF_CHECK", csrfDefault), "true")

	// 在线更新默认：docker 更安全（仅检测）；binary 需显式开启
	updateMode := strings.ToLower(strings.TrimSpace(getenv("UPDATE_MODE", "docker")))
	if updateMode == "" {
		updateMode = "docker"
	}
	if strings.EqualFold(getenv("UPDATE_ENABLED", "true"), "false") {
		updateMode = "disabled"
	}

	requireRedisDefault := "false"
	if prod {
		requireRedisDefault = "true"
	}

	return Config{
		HTTPAddr:        getenv("HTTP_ADDR", ":8080"),
		DatabaseURL:     getenv("DATABASE_URL", "postgres://cardkey:cardkey@localhost:5432/cardkey?sslmode=disable"),
		RedisURL:        getenv("REDIS_URL", "redis://localhost:6379/0"),
		JWTSecret:       getenv("JWT_SECRET", "dev-jwt-secret-change-me-in-production-32b"),
		ContentKeyHex:   getenv("CONTENT_KEY", ""),
		BootstrapUser:   getenv("BOOTSTRAP_ADMIN_USER", "admin"),
		BootstrapPass:   getenv("BOOTSTRAP_ADMIN_PASS", ""),
		PublicRedeemKey: getenv("PUBLIC_REDEEM_API_KEY", ""),
		CORSOrigins: splitCSV(getenv("CORS_ORIGINS",
			"http://localhost:5173,http://127.0.0.1:5173,http://localhost:18080,http://127.0.0.1:18080")),
		StaticDir:           getenv("STATIC_DIR", ""),
		Env:                 env,
		SecureCookie:        secure,
		TrustProxy:          trust,
		DBMaxConns:          int32(EnvInt("DB_MAX_CONNS", 20)),
		DBMinConns:          int32(EnvInt("DB_MIN_CONNS", 2)),
		RequireRedeemAPIKey: strings.EqualFold(getenv("REQUIRE_REDEEM_API_KEY", "false"), "true"),
		CSRFCheck:           csrf,
		RequireRedis:        strings.EqualFold(getenv("REQUIRE_REDIS", requireRedisDefault), "true"),
		MetricsToken:        getenv("METRICS_TOKEN", ""),
		UpdateEnabled:       updateMode != "disabled",
		UpdateMode:          updateMode,
		UpdateGitHubOwner:   getenv("UPDATE_GITHUB_OWNER", "hkx1997"),
		UpdateGitHubRepo:    getenv("UPDATE_GITHUB_REPO", "CardKey"),
		UpdateGitHubToken:   getenv("UPDATE_GITHUB_TOKEN", ""),
		// 空则运行时落到 DATA_DIR/releases 或可写临时目录（勿默认 /opt，容器内通常不存在）
		UpdateReleasesDir: getenv("UPDATE_RELEASES_DIR", ""),
		// 空=自动用 os.Executable()（Docker 内为 /app/cardkey）；勿默认 /opt/...
		UpdateBinaryPath: getenv("UPDATE_BINARY_PATH", ""),
		UpdateKeepReleases:  EnvInt("UPDATE_KEEP_RELEASES", 5),
	}
}

// ValidateProduction 生产环境强校验，避免空密钥/弱配置。
func (c Config) ValidateProduction() error {
	if c.Env != "production" {
		return nil
	}
	if len(c.JWTSecret) < 32 {
		return errf("production requires JWT_SECRET >= 32 characters")
	}
	low := strings.ToLower(c.JWTSecret)
	for _, s := range deniedJWTSubstr {
		if strings.Contains(low, s) {
			return errf("production JWT_SECRET looks like a default/dev secret; generate a random one")
		}
	}
	if c.ContentKeyHex == "" {
		return errf("production requires CONTENT_KEY (64 hex chars = 32 bytes AES)")
	}
	if len(c.ContentKeyHex) != 64 {
		return errf("CONTENT_KEY must be 64 hex characters")
	}
	if deniedContentKeys[strings.ToLower(c.ContentKeyHex)] {
		return errf("production CONTENT_KEY must not use the documented example key; run: openssl rand -hex 32")
	}
	// 校验 hex
	for _, ch := range strings.ToLower(c.ContentKeyHex) {
		if (ch < '0' || ch > '9') && (ch < 'a' || ch > 'f') {
			return errf("CONTENT_KEY must be hex")
		}
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
