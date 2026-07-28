package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"net/url"
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
	// CtxAuthKind: "jwt" | "apikey"
	CtxAuthKind    ctxKey = "authKind"
	CtxAPIKeyID    ctxKey = "apiKeyId"
	CtxAPIKeyScopes ctxKey = "apiKeyScopes"
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
	wildcard := false
	for _, o := range origins {
		o = strings.TrimSpace(o)
		if o == "*" {
			// 禁止 * + credentials；忽略通配，仅显式白名单
			wildcard = true
			continue
		}
		if o != "" {
			allow[o] = true
		}
	}
	_ = wildcard
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" && allow[origin] {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
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

// CSRFOrigin 对带 Cookie 的写操作严格校验 Origin/Referer 同源。
// - 仅 Bearer（无 Cookie）的机器 API 跳过
// - 浏览器 Cookie 会话：必须有 Origin 或 Referer，且 host 与请求 Host 精确匹配
func CSRFOrigin(enabled bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !enabled || r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}
			// 纯 Bearer、无会话 Cookie → 跳过（脚本 / API Key 场景）
			_, hasCookie := r.Cookie("cardkey_token")
			hasBearer := strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ")
			if hasBearer && hasCookie != nil {
				next.ServeHTTP(w, r)
				return
			}
			// 无 Cookie 且无 Bearer 的写操作（如公开 setup/redeem）不强制 CSRF 同源
			// 但有 Cookie 时必须校验
			if hasCookie != nil {
				next.ServeHTTP(w, r)
				return
			}

			src := r.Header.Get("Origin")
			if src == "" {
				src = r.Header.Get("Referer")
			}
			if src == "" {
				response.Fail(w, apperr.Forbidden("缺少 Origin/Referer，跨站请求被拒绝"))
				return
			}
			if !sameOriginHost(src, r.Host) {
				response.Fail(w, apperr.Forbidden("跨站请求被拒绝"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// sameOriginHost 比较 Origin/Referer 的 host 与请求 Host（忽略默认端口差异）。
func sameOriginHost(originOrRef, reqHost string) bool {
	u, err := url.Parse(originOrRef)
	if err != nil || u.Host == "" {
		return false
	}
	return normalizeHost(u.Host) == normalizeHost(reqHost)
}

func normalizeHost(h string) string {
	h = strings.ToLower(strings.TrimSpace(h))
	// 去掉默认端口
	if strings.HasSuffix(h, ":443") && strings.Count(h, ":") == 1 {
		h = strings.TrimSuffix(h, ":443")
	}
	if strings.HasSuffix(h, ":80") && strings.Count(h, ":") == 1 {
		h = strings.TrimSuffix(h, ":80")
	}
	return h
}

// ProtectMetrics 保护 /metrics：配置了 token 则校验；生产未配置则 404。
func ProtectMetrics(token string, isProd bool, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok := strings.TrimSpace(token)
		if tok == "" {
			if isProd {
				http.NotFound(w, r)
				return
			}
			next(w, r)
			return
		}
		got := ""
		if ah := r.Header.Get("Authorization"); strings.HasPrefix(ah, "Bearer ") {
			got = strings.TrimSpace(strings.TrimPrefix(ah, "Bearer "))
		}
		if got == "" {
			got = r.Header.Get("X-Metrics-Token")
		}
		// 生产不接受 query token（易进 access log / Referer）
		if got == "" && !isProd {
			got = r.URL.Query().Get("token")
		}
		if got != tok {
			response.Fail(w, apperr.Unauthorized("metrics 需要有效令牌"))
			return
		}
		next(w, r)
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
			reqID := r.Header.Get("X-Request-Id")
			if reqID == "" {
				reqID = r.Header.Get("X-Request-ID")
			}
			log.Info("http",
				"method", r.Method,
				"path", r.URL.Path,
				"status", rw.status,
				"ms", time.Since(start).Milliseconds(),
				"ip", ClientIP(r),
				"requestId", reqID,
				"user", Username(r.Context()),
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
				response.Fail(w, apperr.Unauthorized("未登录或缺少 API Key（Authorization: Bearer …）"))
				return
			}

			// 1) 形似 JWT → 先验会话；失败再回退 API Key（避免 API Key 被误报「会话过期」）
			var jwtErr error
			if isLikelyJWT(token) {
				claims, err := a.ParseJWT(r.Context(), token)
				if err == nil {
					ctx := context.WithValue(r.Context(), CtxAdminID, claims.AdminID)
					ctx = context.WithValue(ctx, CtxUsername, claims.Username)
					ctx = context.WithValue(ctx, CtxJWTRaw, token)
					ctx = context.WithValue(ctx, CtxAuthKind, "jwt")
					next.ServeHTTP(w, r.WithContext(ctx))
					return
				}
				jwtErr = err
			}

			// 2) API Key：admin:api 或 system:update（后者仅应配合更新类路由；细粒度由 RequireAdminScope 再卡）
			ident, err := a.AuthenticateAPIKeyIdentity(r.Context(), token, "admin:api")
			if err != nil {
				ident, err = a.AuthenticateAPIKeyIdentity(r.Context(), token, "system:update")
			}
			if err != nil {
				// 非 ck_ 且未判为 JWT 时，再试一次 JWT（兼容边界 token）
				if jwtErr == nil && !isLikelyJWT(token) {
					if claims, jerr := a.ParseJWT(r.Context(), token); jerr == nil {
						ctx := context.WithValue(r.Context(), CtxAdminID, claims.AdminID)
						ctx = context.WithValue(ctx, CtxUsername, claims.Username)
						ctx = context.WithValue(ctx, CtxJWTRaw, token)
						ctx = context.WithValue(ctx, CtxAuthKind, "jwt")
						next.ServeHTTP(w, r.WithContext(ctx))
						return
					}
				}
				// JWT 形态失败时保留会话错误；否则返回 API Key 错误（旧版会把 Key 误报成会话过期）
				if jwtErr != nil && !strings.HasPrefix(token, "ck_") {
					response.Fail(w, jwtErr)
					return
				}
				response.Fail(w, err)
				return
			}
			label := ident.Name
			if label == "" {
				label = ident.Prefix
			}
			ctx := context.WithValue(r.Context(), CtxAdminID, "")
			ctx = context.WithValue(ctx, CtxUsername, "apikey:"+label)
			ctx = context.WithValue(ctx, CtxAuthKind, "apikey")
			ctx = context.WithValue(ctx, CtxAPIKeyID, ident.ID)
			ctx = context.WithValue(ctx, CtxAPIKeyScopes, ident.Scopes)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireAdminScope 在已通过 RequireAdmin 后，限制 API Key 必须具备 needScope。
// JWT 会话始终放行；admin:api 覆盖所有 need。
func RequireAdminScope(a *app.App, needScope string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			kind, _ := r.Context().Value(CtxAuthKind).(string)
			if kind != "apikey" {
				next.ServeHTTP(w, r)
				return
			}
			scopes, _ := r.Context().Value(CtxAPIKeyScopes).([]string)
			ok := false
			for _, sc := range scopes {
				if sc == needScope || sc == "admin:api" {
					ok = true
					break
				}
			}
			if !ok {
				response.Fail(w, apperr.Forbidden("API Key 权限不足（需要 "+needScope+" 或 admin:api）"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func isLikelyJWT(s string) bool {
	// header.payload.sig
	if strings.Count(s, ".") != 2 {
		return false
	}
	// API Key 常见 ck_ 前缀（即使含「.」也不当 JWT）
	if strings.HasPrefix(s, "ck_") {
		return false
	}
	return true
}

// RequirePasswordChanged 强制改密：除改密/登出/me 外拦截。API Key 鉴权跳过。
func RequirePasswordChanged(a *app.App) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if AuthKind(r.Context()) == "apikey" {
				next.ServeHTTP(w, r)
				return
			}
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

// cookieOrBearer 优先 Authorization Bearer（API Key / 显式 JWT），否则用会话 Cookie。
// 避免浏览器残留过期 Cookie 盖住脚本传来的有效 API Key。
func cookieOrBearer(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		if t := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer ")); t != "" {
			return t
		}
	}
	if c, err := r.Cookie("cardkey_token"); err == nil && c.Value != "" {
		return c.Value
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
	// 无中间件上下文时不盲目信任 X-Forwarded-For
	return httpx.ClientIP(r, false)
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

func AuthKind(ctx context.Context) string {
	v, _ := ctx.Value(CtxAuthKind).(string)
	return v
}

func APIKeyID(ctx context.Context) string {
	v, _ := ctx.Value(CtxAPIKeyID).(string)
	return v
}
