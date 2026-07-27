package version

// 构建时通过 -ldflags 注入：
// -X github.com/cardkey/cardkey/internal/version.Version=0.1.0
// -X github.com/cardkey/cardkey/internal/version.Commit=abc
// -X github.com/cardkey/cardkey/internal/version.BuildTime=...
var (
	Version   = "0.1.0"
	Commit    = "dev"
	BuildTime = "unknown"
)

func Info() map[string]string {
	return map[string]string{
		"version":   Version,
		"commit":    Commit,
		"buildTime": BuildTime,
	}
}
