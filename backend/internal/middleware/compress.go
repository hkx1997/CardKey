package middleware

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"sync"
)

var gzipWriterPool = sync.Pool{
	New: func() any {
		w, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed)
		return w
	},
}

type gzipResponseWriter struct {
	http.ResponseWriter
	gz      *gzip.Writer
	wroteH  bool
	skip    bool
	minSize int
	buf     []byte
}

func (w *gzipResponseWriter) WriteHeader(status int) {
	w.wroteH = true
	// 小响应 / 已编码则跳过
	if w.skip {
		w.ResponseWriter.WriteHeader(status)
		return
	}
	ct := w.Header().Get("Content-Type")
	if strings.Contains(ct, "image/") || strings.Contains(ct, "zip") || strings.Contains(ct, "octet-stream") {
		w.skip = true
		w.ResponseWriter.WriteHeader(status)
		return
	}
	w.Header().Del("Content-Length")
	w.Header().Set("Content-Encoding", "gzip")
	w.Header().Add("Vary", "Accept-Encoding")
	w.ResponseWriter.WriteHeader(status)
}

func (w *gzipResponseWriter) Write(b []byte) (int, error) {
	if !w.wroteH {
		w.WriteHeader(http.StatusOK)
	}
	if w.skip {
		return w.ResponseWriter.Write(b)
	}
	return w.gz.Write(b)
}

func (w *gzipResponseWriter) Flush() {
	if w.gz != nil && !w.skip {
		_ = w.gz.Flush()
	}
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Gzip 对 Accept-Encoding: gzip 的响应做压缩（BestSpeed，低 CPU）。
// 跳过 health/metrics 与已压缩类型。
func Gzip(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead || !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		path := r.URL.Path
		if path == "/healthz" || path == "/readyz" || path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}
		gz := gzipWriterPool.Get().(*gzip.Writer)
		gz.Reset(w)
		grw := &gzipResponseWriter{ResponseWriter: w, gz: gz}
		defer func() {
			if !grw.skip {
				_ = gz.Close()
			}
			gz.Reset(io.Discard)
			gzipWriterPool.Put(gz)
		}()
		next.ServeHTTP(grw, r)
	})
}
