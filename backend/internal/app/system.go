package app

import (
	"context"
	"runtime"
	"time"

	"github.com/cardkey/cardkey/internal/db"
	"github.com/cardkey/cardkey/internal/version"
	"github.com/cardkey/cardkey/migrations"
)

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
	return SystemInfo{
		Version:            version.Version,
		Commit:             version.Commit,
		BuildTime:          version.BuildTime,
		GoVersion:          runtime.Version(),
		GOOS:               runtime.GOOS,
		GOARCH:             runtime.GOARCH,
		UpdateMode:         mode,
		StartedAt:          processStart.UTC().Format(time.RFC3339),
		UptimeSec:          int64(time.Since(processStart).Seconds()),
		MigrationsEmbedded: true,
		MigrationsBundled:  bundled,
		MigrationsApplied:  applied,
	}
}
