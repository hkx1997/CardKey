package app

import (
	"context"
	"runtime"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// 进程内运行时指标（仪表盘 /metrics 共用）
var (
	httpInFlight   atomic.Int64
	httpTotal      atomic.Int64
	httpErrors5xx  atomic.Int64
	httpErrors4xx  atomic.Int64
	redeemOKTotal  = &metricRedeemsTotal
	redeemErrTotal = &metricRedeemErrors
	loginTotal     = &metricLoginsTotal
)

type latencySample struct {
	mu   sync.Mutex
	ring []time.Duration
	pos  int
	n    int
}

const latencyRingSize = 512

var latSamples = &latencySample{
	ring: make([]time.Duration, latencyRingSize),
}

func (s *latencySample) Add(d time.Duration) {
	s.mu.Lock()
	s.ring[s.pos] = d
	s.pos = (s.pos + 1) % len(s.ring)
	if s.n < len(s.ring) {
		s.n++
	}
	s.mu.Unlock()
}

func (s *latencySample) Percentile(p float64) float64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.n == 0 {
		return 0
	}
	cp := make([]time.Duration, s.n)
	if s.n < len(s.ring) {
		copy(cp, s.ring[:s.n])
	} else {
		// 已满环：从 pos 开始拼一圈
		for i := 0; i < s.n; i++ {
			cp[i] = s.ring[(s.pos+i)%len(s.ring)]
		}
	}
	sort.Slice(cp, func(i, j int) bool { return cp[i] < cp[j] })
	idx := int(float64(s.n-1) * p)
	if idx < 0 {
		idx = 0
	}
	if idx >= s.n {
		idx = s.n - 1
	}
	return float64(cp[idx].Microseconds()) / 1000.0
}

// 近 1 分钟请求时间戳（滑动窗口）
type minuteWindow struct {
	mu  sync.Mutex
	ts  []int64 // unix milli
}

var reqWindow = &minuteWindow{}

func (w *minuteWindow) Hit() {
	w.mu.Lock()
	now := time.Now().UnixMilli()
	w.ts = append(w.ts, now)
	w.pruneLocked(now)
	w.mu.Unlock()
}

func (w *minuteWindow) pruneLocked(now int64) {
	cut := now - 60_000
	i := 0
	for i < len(w.ts) && w.ts[i] < cut {
		i++
	}
	if i > 0 {
		w.ts = append([]int64(nil), w.ts[i:]...)
	}
	// 防止无限增长
	if len(w.ts) > 100_000 {
		w.ts = w.ts[len(w.ts)-50_000:]
	}
}

func (w *minuteWindow) Count1m() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.pruneLocked(time.Now().UnixMilli())
	return len(w.ts)
}

// RecordHTTP 由中间件调用
func RecordHTTP(status int, d time.Duration) {
	httpTotal.Add(1)
	reqWindow.Hit()
	latSamples.Add(d)
	if status >= 500 {
		httpErrors5xx.Add(1)
	} else if status >= 400 {
		httpErrors4xx.Add(1)
	}
}

func TrackInFlight(delta int64) {
	httpInFlight.Add(delta)
}

// RuntimeMetrics 仪表盘实时监控
type RuntimeMetrics struct {
	InFlight       int64   `json:"inFlight"`
	RequestsTotal  int64   `json:"requestsTotal"`
	Requests1m     int     `json:"requests1m"`
	Errors4xx      int64   `json:"errors4xx"`
	Errors5xx      int64   `json:"errors5xx"`
	ErrorRatePct   float64 `json:"errorRatePct"`
	LatencyP50Ms   float64 `json:"latencyP50Ms"`
	LatencyP95Ms   float64 `json:"latencyP95Ms"`
	LatencyP99Ms   float64 `json:"latencyP99Ms"`
	RedeemsTotal   int64   `json:"redeemsTotal"`
	RedeemErrors   int64   `json:"redeemErrors"`
	LoginsTotal    int64   `json:"loginsTotal"`
	DBPoolAcquired int32   `json:"dbPoolAcquired"`
	DBPoolIdle     int32   `json:"dbPoolIdle"`
	DBPoolTotal    int32   `json:"dbPoolTotal"`
	DBPoolMax      int32   `json:"dbPoolMax"`
	RedisOK        bool    `json:"redisOk"`
	UptimeSec      int64   `json:"uptimeSec"`
	GoRoutines     int     `json:"goRoutines"`
	MemAllocMB     float64 `json:"memAllocMB"`
	Version        string  `json:"version"`
	UpdateMode     string  `json:"updateMode"`
	CheckedAt      string  `json:"checkedAt"`
}

func (a *App) RuntimeMetrics(ctx context.Context) RuntimeMetrics {
	info := a.SystemInfo(ctx)
	total := httpTotal.Load()
	e5 := httpErrors5xx.Load()
	e4 := httpErrors4xx.Load()
	errRate := 0.0
	if total > 0 {
		errRate = float64(e5+e4) / float64(total) * 100
	}
	m := RuntimeMetrics{
		InFlight:      httpInFlight.Load(),
		RequestsTotal: total,
		Requests1m:    reqWindow.Count1m(),
		Errors4xx:     e4,
		Errors5xx:     e5,
		ErrorRatePct:  errRate,
		LatencyP50Ms:  latSamples.Percentile(0.50),
		LatencyP95Ms:  latSamples.Percentile(0.95),
		LatencyP99Ms:  latSamples.Percentile(0.99),
		RedeemsTotal:  redeemOKTotal.Load(),
		RedeemErrors:  redeemErrTotal.Load(),
		LoginsTotal:   loginTotal.Load(),
		RedisOK:       false,
		UptimeSec:     info.UptimeSec,
		GoRoutines:    runtime.NumGoroutine(),
		Version:       info.Version,
		UpdateMode:    info.UpdateMode,
		CheckedAt:     time.Now().UTC().Format(time.RFC3339),
	}
	if a.Pool != nil {
		st := a.Pool.Stat()
		m.DBPoolAcquired = st.AcquiredConns()
		m.DBPoolIdle = st.IdleConns()
		m.DBPoolTotal = st.TotalConns()
		m.DBPoolMax = st.MaxConns()
	}
	if a.RDB != nil {
		cctx, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
		err := a.RDB.Ping(cctx).Err()
		cancel()
		m.RedisOK = err == nil
	}
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	m.MemAllocMB = float64(ms.Alloc) / (1024 * 1024)
	return m
}
