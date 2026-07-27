package app

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/cardkey/cardkey/internal/crypto"
	"github.com/cardkey/cardkey/internal/domain"
	"github.com/cardkey/cardkey/internal/ratelimit"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type App struct {
	Pool         *pgxpool.Pool
	RDB          *redis.Client
	Limiter      *ratelimit.Limiter
	AESKey       []byte
	JWTSecret    []byte
	Log          *slog.Logger
	SecureCookie bool
	TrustProxy   bool
	CSRFCheck    bool
	Env          string

	RequireRedeemAPIKey bool
	MetricsToken        string

	UpdateEnabled      bool
	UpdateMode         string
	UpdateGitHubOwner  string
	UpdateGitHubRepo   string
	UpdateGitHubToken  string
	UpdateReleasesDir  string
	UpdateBinaryPath   string
	UpdateKeepReleases int

	// DataDir 本地数据（上传图片等），默认 /app/data 或 ./data
	DataDir string

	settingsMu    sync.RWMutex
	settingsCache *domain.Settings
	settingsAt    time.Time

	updateMu     sync.RWMutex
	updateStatus UpdateStatus
	// 检测更新结果缓存（进程内）
	updateCheckCacheMu sync.Mutex
	updateCheckCache   *updateCheckCache
}

const settingsTTL = 30 * time.Second

func (a *App) Audit(ctx context.Context, actorType, actorLabel, action, resource, detail, ip string) {
	// 审计不应被请求取消中断；独立短超时
	actx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	_, err := a.Pool.Exec(actx, `
		INSERT INTO audit_logs(actor_type, actor_label, action, resource, detail, ip)
		VALUES($1,$2,$3,$4,$5,NULLIF($6,'')::inet)`,
		actorType, actorLabel, action, resource, detail, ip)
	if err != nil {
		a.Log.Warn("audit write failed", "err", err)
	}
}

// Ready 检查依赖可用性。
func (a *App) Ready(ctx context.Context) error {
	if err := a.Pool.Ping(ctx); err != nil {
		return err
	}
	if a.RDB != nil {
		if err := a.RDB.Ping(ctx).Err(); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) DefaultSettings() domain.Settings {
	return domain.Settings{
		SiteName:                    "CardKey",
		SiteLogo:                    "",
		SiteFavicon:                 "",
		FooterText:                  "CardKey",
		DocumentTitle:               "CardKey",
		RedeemTitle:                 "卡密兑换",
		RedeemSubtitle:              "选择类别并输入兑换编码，支持一行一个批量兑换",
		RedeemSuccessHint:           "兑换成功",
		RedeemPlaceholder:           "",
		RedeemButtonText:            "立即兑换",
		RedeemTabVisibleCount:       4,
		CaptchaEnabled:              false,
		AllowRequery:                true,
		RateLimitIpPerMin:           60,
		RateLimitCodePerMin:         20,
		RateLimitFailClosed:         false,
		MaskCardErrors:              true,
		ApiDocsEnabled:              true,
		ShowApiDocsEntry:            true,
		// 默认不在公开文档暴露兑换密钥（需管理员显式开启）
		ExposePublicRedeemKeyInDocs: false,
		PublicRedeemApiKey:          "",
		ApiBasePath:                 "/api/v1",
		ApiPublicBaseUrl:            "",
	}
}

func (a *App) GetSettings(ctx context.Context) (domain.Settings, error) {
	a.settingsMu.RLock()
	if a.settingsCache != nil && time.Since(a.settingsAt) < settingsTTL {
		s := *a.settingsCache
		a.settingsMu.RUnlock()
		return s, nil
	}
	a.settingsMu.RUnlock()

	s, err := a.loadSettings(ctx)
	if err != nil {
		return s, err
	}
	a.settingsMu.Lock()
	a.settingsCache = &s
	a.settingsAt = time.Now()
	a.settingsMu.Unlock()
	return s, nil
}

func (a *App) loadSettings(ctx context.Context) (domain.Settings, error) {
	s := a.DefaultSettings()
	var raw json.RawMessage
	err := a.Pool.QueryRow(ctx, `SELECT value FROM settings WHERE key='all'`).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return s, nil
		}
		return s, err
	}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &s)
	}
	return s, nil
}

func (a *App) InvalidateSettingsCache() {
	a.settingsMu.Lock()
	a.settingsCache = nil
	a.settingsAt = time.Time{}
	a.settingsMu.Unlock()
}

func (a *App) SaveSettings(ctx context.Context, s domain.Settings) error {
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	_, err = a.Pool.Exec(ctx, `
		INSERT INTO settings(key, value, updated_at) VALUES('all', $1::jsonb, now())
		ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, string(b))
	if err != nil {
		return err
	}
	a.settingsMu.Lock()
	cp := s
	a.settingsCache = &cp
	a.settingsAt = time.Now()
	a.settingsMu.Unlock()
	return nil
}

func (a *App) EncryptContent(plain string) (enc, nonce []byte, err error) {
	return crypto.Encrypt(a.AESKey, []byte(plain))
}

func (a *App) DecryptContent(enc, nonce []byte) (string, error) {
	b, err := crypto.Decrypt(a.AESKey, enc, nonce)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func formatTS(t time.Time) string {
	return domain.FormatTime(t)
}
