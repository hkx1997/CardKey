package app

import (
	"context"
	"runtime"
	"time"

	"github.com/cardkey/cardkey/internal/version"
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
}

var processStart = time.Now()

func (a *App) SystemInfo(_ context.Context) SystemInfo {
	mode := a.UpdateMode
	if mode == "" {
		mode = "disabled"
	}
	return SystemInfo{
		Version:    version.Version,
		Commit:     version.Commit,
		BuildTime:  version.BuildTime,
		GoVersion:  runtime.Version(),
		GOOS:       runtime.GOOS,
		GOARCH:     runtime.GOARCH,
		UpdateMode: mode,
		StartedAt:  processStart.UTC().Format(time.RFC3339),
		UptimeSec:  int64(time.Since(processStart).Seconds()),
	}
}
