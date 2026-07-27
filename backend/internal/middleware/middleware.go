package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/cardkey/cardkey/internal/app"
	"github.com/cardkey/cardkey/internal/pkg/apperr"
	"github.com/cardkey/cardkey/internal/pkg/httpx"
	"github.com/cardkey/cardkey/internal/pkg/response"
)

type ctxKey string

const (
	CtxAdminID  ctxKey = "adminId"
	CtxUsername ctxKey = "username"
	CtxClientIP ctxKey = "clientIP"
	CtxJWTRaw   ctxKey = "jwtRaw"
)

func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-XSS-Protection", "0")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		next.ServeHTTP(w, r)
	})
}

func CORS(origins []string) func(http.Handler) http.Handler {
	allow := map[string]bool{}
	for _, o := range origins {
		allow[strings.TrimSpace(o)] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if allow[origin] || allow["*"] {
				if origin != "" {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Vary", "Origin")
				}
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
				w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
				w.Header().Set("Access-Control-Max-Age", "600")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func ClientIPMiddleware(trustProxy bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := httpx.ClientIP(r, trustProxy)
			ctx := context.WithValue(r.Context(), CtxClientIP, ip)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func BodyLimit(maxBytes int64) func(http.Handler) http.Handler {
	if maxBytes <= 0 {
		maxBytes = httpx.DefaultMaxBody
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil && r.Method != http.MethodGet && r.Method != http.MethodHead {
				r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			}
			next.ServeHTTP(w, r)
		})
	}
}

// CSRFOrigin 对带 Cookie 的写操作校验 Origin/Referer 同源（简单 CSRF 防护）。
func CSRFOrigin(enabled bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !enabled || r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}
			// Bearer 无 Cookie 场景跳过（机器 API）
			if strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
				if _, err := r.Cookie("cardkey_token"); err != nil {
					next.ServeHTTP(w, r)
					return
				}
			}
			origin := r.Header.Get("Origin")
			if origin == "" {
				if ref := r.Header.Get("Referer"); ref != "" {
					// 取 scheme://host
					if i := strings.Index(ref[8:], "/"); i >= 0 && len(ref) > 8 {
						// keep simple: if referer host matches Host
					}
					origin = ref
				}
			}
			if origin != "" {
				// 允许同源：Origin 包含 Host
				host := r.Host
				if !strings.Contains(origin, host) {
					response.Fail(w, apperr.Forbidden("跨站请求被拒绝"))
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func AccessLog(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" || r.URL.Path == "/metrics" {
				next.ServeHTTP(w, r)
				return
			}
			start := time.Now()
			rw := &statusWriter{ResponseWriter: w, status: 200}
			next.ServeHTTP(rw, r)
			log.Info("http",
				"method", r.Method,
				"path", r.URL.Path,
				"status", rw.status,
				"ms", time.Since(start).Milliseconds(),
				"ip", ClientIP(r),
			)
		})
	}
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func RequireAdmin(a *app.App) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := cookieOrBearer(r)
			if token == "" {
				response.Fail(w, apperr.Unauthorized("未登录"))
				return
			}
			claims, err := a.ParseJWT(r.Context(), token)
			if err != nil {
				response.Fail(w, err)
				return
			}
			ctx := context.WithValue(r.Context(), CtxAdminID, claims.AdminID)
			ctx = context.WithValue(ctx, CtxUsername, claims.Username)
			ctx = context.WithValue(ctx, CtxJWTRaw, token)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequirePasswordChanged 强制改密：除改密/登出/me 外拦截。
func RequirePasswordChanged(a *app.App) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			if strings.HasSuffix(path, "/auth/change-password") ||
				strings.HasSuffix(path, "/auth/logout") ||
				strings.HasSuffix(path, "/auth/me") ||
				strings.HasSuffix(path, "/system/info") {
				next.ServeHTTP(w, r)
				return
			}
			id := AdminID(r.Context())
			if id == "" {
				next.ServeHTTP(w, r)
				return
			}
			must, err := a.MustChangePassword(r.Context(), id)
			if err == nil && must {
				response.Fail(w, apperr.Forbidden("请先修改初始密码"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func cookieOrBearer(r *http.Request) string {
	if c, err := r.Cookie("cardkey_token"); err == nil && c.Value != "" {
		return c.Value
	}
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	}
	return ""
}

func BearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	}
	return ""
}

func ClientIP(r *http.Request) string {
	if v, ok := r.Context().Value(CtxClientIP).(string); ok && v != "" {
		return v
	}
	return httpx.ClientIP(r, true)
}

func AdminID(ctx context.Context) string {
	v, _ := ctx.Value(CtxAdminID).(string)
	return v
}

func Username(ctx context.Context) string {
	v, _ := ctx.Value(CtxUsername).(string)
	return v
}

func JWTRaw(ctx context.Context) string {
	v, _ := ctx.Value(CtxJWTRaw).(string)
	return v
}
