package app

import (
	"context"
	"os"
	"runtime"
	"time"

	"github.com/cardkey/cardkey/internal/config"
	"github.com/cardkey/cardkey/internal/db"
	"github.com/cardkey/cardkey/internal/version"
	"github.com/cardkey/cardkey/internal/webstatic"
	"github.com/cardkey/cardkey/migrations"
)

type SystemWarning struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type SystemInfo struct {
	Version    string `json:"version"`
	Commit     string `json:"commit"`
	BuildTime  string `json:"buildTime"`
	GoVersion  string `json:"goVersion"`
	GOOS       string `json:"goos"`
	GOARCH     string `json:"goarch"`
	UpdateMode string `json:"updateMode"`
	StartedAt  string `json:"startedAt"`
	UptimeSec  int64  `json:"uptimeSec"`
	// 在线更新：迁移随二进制嵌入，重启后自动执行
	MigrationsEmbedded bool     `json:"migrationsEmbedded"`
	MigrationsBundled  []string `json:"migrationsBundled"`
	MigrationsApplied  []string `json:"migrationsApplied"`
	// 静态与进程可观测性（排障空壳包 / 502）
	StaticEmbedded      bool   `json:"staticEmbedded"`
	StaticEmbeddedFiles int    `json:"staticEmbeddedFiles"`
	BinaryPath          string `json:"binaryPath,omitempty"`
	BinarySize          int64  `json:"binarySize,omitempty"`
	CSRFCheck           bool   `json:"csrfCheck"`
	Env                 string `json:"env"`
	// 非致命生产建议
	Warnings []SystemWarning `json:"warnings"`
}

var processStart = time.Now()

func (a *App) SystemInfo(ctx context.Context) SystemInfo {
	mode := a.UpdateMode
	if mode == "" {
		mode = "disabled"
	}
	bundled, _ := db.ListSQLFiles(migrations.FS)
	if bundled == nil {
		bundled = []string{}
	}
	applied := []string{}
	if a.Pool != nil {
		if list, err := db.ListAppliedMigrations(ctx, a.Pool); err == nil {
			applied = list
		}
	}

	binPath := ""
	var binSize int64
	if p, err := os.Executable(); err == nil {
		binPath = p
		if st, e2 := os.Stat(p); e2 == nil {
			binSize = st.Size()
		}
	}

	warns := make([]SystemWarning, 0)
	for _, w := range a.collectRuntimeWarnings(binSize) {
		warns = append(warns, w)
	}

	return SystemInfo{
		Version:             version.Version,
		Commit:              version.Commit,
		BuildTime:           version.BuildTime,
		GoVersion:           runtime.Version(),
		GOOS:                runtime.GOOS,
		GOARCH:              runtime.GOARCH,
		UpdateMode:          mode,
		StartedAt:           processStart.UTC().Format(time.RFC3339),
		UptimeSec:           int64(time.Since(processStart).Seconds()),
		MigrationsEmbedded:  true,
		MigrationsBundled:   bundled,
		MigrationsApplied:   applied,
		StaticEmbedded:      webstatic.HasDist(),
		StaticEmbeddedFiles: webstatic.AssetCount(),
		BinaryPath:          binPath,
		BinarySize:          binSize,
		CSRFCheck:           a.CSRFCheck,
		Env:                 a.Env,
		Warnings:            warns,
	}
}

func (a *App) collectRuntimeWarnings(binSize int64) []SystemWarning {
	var out []SystemWarning
	// 配置类（与 config.ProductionWarnings 对齐字段）
	if a.Env == "production" {
		cfgLike := config.Config{
			Env:          a.Env,
			CSRFCheck:    a.CSRFCheck,
			MetricsToken: a.MetricsToken,
			RequireRedis: a.RequireRedis,
			SecureCookie: a.SecureCookie,
			// DatabaseURL 不在 App 上；ssl 提示仅在启动日志用完整 cfg
		}
		for _, w := range cfgLike.ProductionWarnings() {
			// 跳过需要 DatabaseURL 的项若空
			if w.Code == "db_ssl_disable" {
				continue
			}
			out = append(out, SystemWarning{Code: w.Code, Message: w.Message})
		}
	}
	if !webstatic.HasDist() || webstatic.AssetCount() < 5 {
		out = append(out, SystemWarning{
			Code:    "spa_thin",
			Message: "嵌入前端资源过少或缺失：可能是空壳二进制，请升级到 ≥13MB 完整 Release 包",
		})
	}
	// 仅 Linux 生产包有意义；Windows 开发体积不同
	if runtime.GOOS == "linux" && binSize > 0 && binSize < 13_000_000 {
		out = append(out, SystemWarning{
			Code:    "binary_small",
			Message: "当前进程二进制小于 13MB，疑似未嵌入 SPA 的空壳包，一键更新/UI 可能异常",
		})
	}
	if a.CaptchaEnabledSetting() {
		// settings 开了但环境未配密钥
		if a.CaptchaSiteKey == "" || a.CaptchaSecretKey == "" {
			out = append(out, SystemWarning{
				Code:    "captcha_incomplete",
				Message: "设置中开启了验证码，但未配置 CAPTCHA_SITE_KEY / CAPTCHA_SECRET_KEY，浏览器兑换不会真正校验",
			})
		}
	}
	return out
}

// CaptchaEnabledSetting 仅读设置位（不要求密钥齐全）；密钥检查见 CaptchaActive。
func (a *App) CaptchaEnabledSetting() bool {
	if a == nil || a.Pool == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	s, err := a.GetSettings(ctx)
	if err != nil {
		return false
	}
	return s.CaptchaEnabled
}
