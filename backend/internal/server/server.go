package server

import (
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/cardkey/cardkey/internal/app"
	"github.com/cardkey/cardkey/internal/handler"
	"github.com/cardkey/cardkey/internal/middleware"
	"github.com/cardkey/cardkey/internal/webstatic"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
)

func New(a *app.App, corsOrigins []string, staticDir string) http.Handler {
	h := &handler.Handler{App: a}
	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(60 * time.Second))
	r.Use(middleware.SecurityHeaders)
	// 卡密文件创建可走 base64 JSON / multipart，上限约 5MB 原文 ≈ 7MB base64
	r.Use(middleware.BodyLimit(12 << 20))
	r.Use(middleware.ClientIPMiddleware(a.TrustProxy))
	r.Use(middleware.HTTPMetrics)
	r.Use(middleware.CSRFOrigin(a.CSRFCheck))
	if a.Log != nil {
		r.Use(middleware.AccessLog(a.Log))
	}
	r.Use(middleware.CORS(corsOrigins))

	r.Get("/healthz", h.Health)
	r.Get("/readyz", h.Ready)
	isProd := a.Env == "production"
	r.Get("/metrics", middleware.ProtectMetrics(a.MetricsToken, isProd, app.MetricsHandler(a)))

	// 浏览器默认会请求 /favicon.ico —— 按系统设置跳转上传图标
	r.Get("/favicon.ico", h.FaviconRedirect)

	// 公开上传静态资源（Logo / Favicon 等）
	if a.DataDir != "" {
		up := filepath.Join(a.DataDir, "uploads")
		_ = os.MkdirAll(up, 0o755)
		// 使用 Get + 显式路径，避免与 SPA /* 抢路由或 FileServer 前缀问题
		r.Get("/uploads/*", func(w http.ResponseWriter, req *http.Request) {
			name := chi.URLParam(req, "*")
			if name == "" {
				// 兼容无 URLParam 的情况
				name = strings.TrimPrefix(req.URL.Path, "/uploads/")
			}
			name = filepath.Clean("/" + name)
			name = strings.TrimPrefix(name, "/")
			if name == "" || name == "." || strings.HasPrefix(name, "..") {
				http.NotFound(w, req)
				return
			}
			full := filepath.Join(up, name)
			// 防目录穿越
			upClean := filepath.Clean(up) + string(os.PathSeparator)
			if full != filepath.Clean(up) && !strings.HasPrefix(full, upClean) {
				http.NotFound(w, req)
				return
			}
			if st, err := os.Stat(full); err != nil || st.IsDir() {
				http.NotFound(w, req)
				return
			}
			switch strings.ToLower(filepath.Ext(full)) {
			case ".ico":
				w.Header().Set("Content-Type", "image/x-icon")
			case ".svg":
				w.Header().Set("Content-Type", "image/svg+xml")
			case ".png":
				w.Header().Set("Content-Type", "image/png")
			case ".jpg", ".jpeg":
				w.Header().Set("Content-Type", "image/jpeg")
			case ".webp":
				w.Header().Set("Content-Type", "image/webp")
			case ".gif":
				w.Header().Set("Content-Type", "image/gif")
			}
			w.Header().Set("Cache-Control", "public, max-age=86400")
			http.ServeFile(w, req, full)
		})
	}

	r.Route("/api/v1", func(r chi.Router) {
		r.Route("/public", func(r chi.Router) {
			r.Get("/config", h.GetPublicConfig)
			r.Get("/category-stock", h.GetPublicCategoryStock)
			r.Get("/setup-status", h.SetupStatus)
			r.Post("/setup", h.CompleteSetup)
			r.Post("/redeem", h.Redeem)
		})

		r.Route("/admin", func(r chi.Router) {
			r.Post("/auth/login", h.Login)
			r.Post("/auth/logout", h.Logout)

			r.Group(func(r chi.Router) {
				r.Use(middleware.RequireAdmin(a))
				r.Get("/auth/me", h.Me)
				r.Post("/auth/change-password", h.ChangePassword)
				r.Get("/system/info", h.SystemInfo)

				r.Group(func(r chi.Router) {
					r.Use(middleware.RequirePasswordChanged(a))

					r.Get("/dashboard/stats", h.Dashboard)
					r.Get("/dashboard/runtime", h.RuntimeMetrics)

					r.Get("/categories", h.ListCategories)
					r.Post("/categories", h.CreateCategory)
					r.Patch("/categories/{id}", h.UpdateCategory)
					r.Delete("/categories/{id}", h.DeleteCategory)

					r.Get("/cards", h.ListCards)
					// export 必须在 {id} 之前注册
					r.Get("/cards/export", h.ExportCards)
					r.Post("/cards/export", h.ExportCards)
					r.Get("/cards/{id}", h.GetCard)
					r.Post("/cards", h.CreateCard)
					r.Post("/cards/import", h.ImportCards)
					r.Post("/cards/batch-action", h.BatchAction)

					r.Get("/batches", h.ListBatches)
					r.Get("/batches/{id}/export", h.ExportBatch)
					r.Delete("/batches/{id}", h.DeleteBatch)
					r.Get("/redeems", h.ListRedeems)

					r.Get("/api-keys", h.ListAPIKeys)
					r.Post("/api-keys", h.CreateAPIKey)
					r.Post("/api-keys/{id}/revoke", h.RevokeAPIKey)
					r.Delete("/api-keys/{id}", h.DeleteAPIKey)
					r.Post("/api-keys/{id}/rotate", h.RotateAPIKey)

					r.Post("/settings/public-redeem-key", h.SetPublicRedeemKey)
					r.Get("/settings", h.GetSettings)
					r.Put("/settings", h.UpdateSettings)
					r.Post("/settings/mail/test", h.TestMail)
					r.Post("/uploads", h.UploadImage)

					r.Get("/audit-logs", h.ListAudit)

					r.Get("/updates/check", h.CheckUpdates)
					r.Get("/updates/history", h.UpdateHistory)
					r.Get("/updates/status", h.UpdateStatus)
					r.Post("/updates/apply", h.ApplyUpdate)
					r.Post("/updates/rollback", h.RollbackUpdate)
				})
			})
		})
	})

	// 嵌入 SPA 优先；磁盘 STATIC_DIR 作缺文件回退（避免 assets 被 SPA 回成 HTML）
	if webstatic.HasDist() {
		disk := ""
		if staticDir != "" {
			if st, err := os.Stat(staticDir); err == nil && st.IsDir() {
				disk = staticDir
			}
		}
		spa := webstatic.Handler(disk)
		r.Get("/*", spa.ServeHTTP)
		r.Head("/*", spa.ServeHTTP)
	} else if staticDir != "" {
		if st, err := os.Stat(staticDir); err == nil && st.IsDir() {
			fileServer(r, staticDir)
		}
	}
	return r
}

func fileServer(r chi.Router, dir string) {
	r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
		p := req.URL.Path
		// 绝不能把 /uploads、/api 回退成 SPA index.html（否则 favicon 会变成 HTML）
		if strings.HasPrefix(p, "/api/") || strings.HasPrefix(p, "/uploads/") {
			http.NotFound(w, req)
			return
		}
		path := filepath.Join(dir, filepath.Clean("/"+p))
		if !strings.HasPrefix(path, filepath.Clean(dir)+string(os.PathSeparator)) && path != filepath.Clean(dir) {
			http.NotFound(w, req)
			return
		}
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			if strings.HasSuffix(path, ".html") {
				w.Header().Set("Cache-Control", "no-cache")
			} else if strings.Contains(path, string(os.PathSeparator)+"assets"+string(os.PathSeparator)) {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			// 显式 MIME，避免被中间层改错
			if strings.HasSuffix(strings.ToLower(path), ".js") {
				w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
			} else if strings.HasSuffix(strings.ToLower(path), ".css") {
				w.Header().Set("Content-Type", "text/css; charset=utf-8")
			}
			http.ServeFile(w, req, path)
			return
		}
		// 资产路径禁止回退 HTML
		if strings.Contains(p, "/assets/") || strings.HasSuffix(strings.ToLower(p), ".js") ||
			strings.HasSuffix(strings.ToLower(p), ".css") {
			http.NotFound(w, req)
			return
		}
		// /favicon.ico 无静态文件时回退到内置 svg（自定义图标由前端 link 注入）
		if p == "/favicon.ico" {
			svg := filepath.Join(dir, "favicon.svg")
			if _, err := os.Stat(svg); err == nil {
				w.Header().Set("Content-Type", "image/svg+xml")
				w.Header().Set("Cache-Control", "public, max-age=3600")
				http.ServeFile(w, req, svg)
				return
			}
		}
		index := filepath.Join(dir, "index.html")
		if _, err := os.Stat(index); err == nil {
			w.Header().Set("Cache-Control", "no-cache")
			http.ServeFile(w, req, index)
			return
		}
		http.NotFound(w, req)
	})
	_ = fs.ValidPath
}
