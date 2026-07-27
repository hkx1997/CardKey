package middleware

import (
	"net/http"
	"time"

	"github.com/cardkey/cardkey/internal/app"
)

// HTTPMetrics 记录并发 / 延迟 / 状态码（跳过健康检查噪声）
func HTTPMetrics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/healthz" || path == "/readyz" || path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}
		app.TrackInFlight(1)
		start := time.Now()
		rw := &statusWriter{ResponseWriter: w, status: 200}
		defer func() {
			app.TrackInFlight(-1)
			app.RecordHTTP(rw.status, time.Since(start))
		}()
		next.ServeHTTP(rw, r)
	})
}
