package app

import (
	"fmt"
	"net/http"
	"sync/atomic"
	"time"
)

// 轻量进程内指标（Prometheus text 格式），无额外依赖。
var (
	metricRedeemsTotal atomic.Int64
	metricRedeemErrors atomic.Int64
	metricLoginsTotal  atomic.Int64
)

func (a *App) IncRedeemOK()  { metricRedeemsTotal.Add(1) }
func (a *App) IncRedeemErr() { metricRedeemErrors.Add(1) }
func (a *App) IncLogin()     { metricLoginsTotal.Add(1) }

func MetricsHandler(a *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		info := a.SystemInfo(r.Context())
		_, _ = fmt.Fprintf(w, "# HELP cardkey_info Build info\n")
		_, _ = fmt.Fprintf(w, "# TYPE cardkey_info gauge\n")
		_, _ = fmt.Fprintf(w, "cardkey_info{version=%q,commit=%q} 1\n", info.Version, info.Commit)
		_, _ = fmt.Fprintf(w, "# HELP cardkey_uptime_seconds Process uptime\n")
		_, _ = fmt.Fprintf(w, "# TYPE cardkey_uptime_seconds gauge\n")
		_, _ = fmt.Fprintf(w, "cardkey_uptime_seconds %d\n", info.UptimeSec)
		_, _ = fmt.Fprintf(w, "# HELP cardkey_redeems_total Successful redeems\n")
		_, _ = fmt.Fprintf(w, "# TYPE cardkey_redeems_total counter\n")
		_, _ = fmt.Fprintf(w, "cardkey_redeems_total %d\n", metricRedeemsTotal.Load())
		_, _ = fmt.Fprintf(w, "# HELP cardkey_redeem_errors_total Redeem errors\n")
		_, _ = fmt.Fprintf(w, "# TYPE cardkey_redeem_errors_total counter\n")
		_, _ = fmt.Fprintf(w, "cardkey_redeem_errors_total %d\n", metricRedeemErrors.Load())
		_, _ = fmt.Fprintf(w, "# HELP cardkey_logins_total Admin logins\n")
		_, _ = fmt.Fprintf(w, "# TYPE cardkey_logins_total counter\n")
		_, _ = fmt.Fprintf(w, "cardkey_logins_total %d\n", metricLoginsTotal.Load())
		_, _ = fmt.Fprintf(w, "# HELP cardkey_http_in_flight Current in-flight HTTP requests\n")
		_, _ = fmt.Fprintf(w, "# TYPE cardkey_http_in_flight gauge\n")
		_, _ = fmt.Fprintf(w, "cardkey_http_in_flight %d\n", httpInFlight.Load())
		_, _ = fmt.Fprintf(w, "# HELP cardkey_http_requests_total HTTP requests\n")
		_, _ = fmt.Fprintf(w, "# TYPE cardkey_http_requests_total counter\n")
		_, _ = fmt.Fprintf(w, "cardkey_http_requests_total %d\n", httpTotal.Load())
		_, _ = fmt.Fprintf(w, "cardkey_http_errors_5xx_total %d\n", httpErrors5xx.Load())
		if a.Pool != nil {
			st := a.Pool.Stat()
			_, _ = fmt.Fprintf(w, "# HELP cardkey_db_pool_acquired\n")
			_, _ = fmt.Fprintf(w, "# TYPE cardkey_db_pool_acquired gauge\n")
			_, _ = fmt.Fprintf(w, "cardkey_db_pool_acquired %d\n", st.AcquiredConns())
			_, _ = fmt.Fprintf(w, "cardkey_db_pool_idle %d\n", st.IdleConns())
			_, _ = fmt.Fprintf(w, "cardkey_db_pool_total %d\n", st.TotalConns())
		}
		_ = time.Now()
	}
}
