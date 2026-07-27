package webstatic

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// Dist 嵌入前端构建产物（pnpm build → dist）。
// 一键更新只换二进制时，UI/CSS 也会一并更新，避免线上弹窗溢出等前端修复「装不上」。
//
//go:embed all:dist
var Dist embed.FS

// HasDist 是否包含可用 index.html
func HasDist() bool {
	f, err := Dist.Open("dist/index.html")
	if err != nil {
		return false
	}
	_ = f.Close()
	return true
}

// FS 返回以 dist 为根的 fs.FS
func FS() (fs.FS, error) {
	return fs.Sub(Dist, "dist")
}

// Handler SPA 静态服务：真实文件优先，否则 index.html
func Handler() http.Handler {
	sub, err := FS()
	if err != nil {
		return http.NotFoundHandler()
	}
	fileServer := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if strings.HasPrefix(p, "/api/") || strings.HasPrefix(p, "/uploads/") {
			http.NotFound(w, r)
			return
		}
		// 清理路径
		clean := path.Clean("/" + p)
		if clean == "/" {
			// index
			serveIndex(w, r, sub)
			return
		}
		rel := strings.TrimPrefix(clean, "/")
		if f, err := sub.Open(rel); err == nil {
			_ = f.Close()
			// assets 长缓存
			if strings.HasPrefix(rel, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else if strings.HasSuffix(rel, ".html") {
				w.Header().Set("Cache-Control", "no-cache")
			}
			fileServer.ServeHTTP(w, r)
			return
		}
		// SPA fallback
		serveIndex(w, r, sub)
	})
}

func serveIndex(w http.ResponseWriter, r *http.Request, sub fs.FS) {
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	b, err := fs.ReadFile(sub, "index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	_, _ = w.Write(b)
}
