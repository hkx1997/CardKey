package webstatic

import (
	"embed"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// Dist 嵌入前端构建产物（pnpm build → dist）。
// 一键更新只换二进制时，UI/CSS 也会一并更新。
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

// AssetCount 嵌入包内文件数（启动日志用）
func AssetCount() int {
	n := 0
	_ = fs.WalkDir(Dist, "dist", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		n++
		return nil
	})
	return n
}

// FS 返回以 dist 为根的 fs.FS
func FS() (fs.FS, error) {
	return fs.Sub(Dist, "dist")
}

// SyncToDir 将嵌入的 SPA 全量写出到 dir（可写时）。
// stamp 非空时写入 .cardkey-spa-stamp；若磁盘 stamp 已相同则跳过整树同步（加速启动）。
// 返回写出/已对齐的文件数；dir 不可写时返回 0, nil。
func SyncToDir(dir, stamp string) (int, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return 0, nil
	}
	sub, err := FS()
	if err != nil {
		return 0, err
	}
	if _, err := os.Stat(dir); err != nil {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return 0, nil // 不可写则跳过，不阻断启动
		}
	}
	// 写探针
	probe := filepath.Join(dir, ".cardkey-static-write-probe")
	if err := os.WriteFile(probe, []byte("1"), 0o600); err != nil {
		return 0, nil
	}
	_ = os.Remove(probe)

	stampPath := filepath.Join(dir, ".cardkey-spa-stamp")
	if stamp != "" {
		if old, err := os.ReadFile(stampPath); err == nil && string(old) == stamp {
			// 版本未变：快速路径，不扫盘写文件
			return AssetCount(), nil
		}
	}

	n := 0
	err = fs.WalkDir(sub, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		data, err := fs.ReadFile(sub, p)
		if err != nil {
			return err
		}
		dest := filepath.Join(dir, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return err
		}
		// 仅内容变化时写入，减少 IO
		if old, err := os.ReadFile(dest); err == nil && string(old) == string(data) {
			n++
			return nil
		}
		tmp := dest + ".tmp"
		if err := os.WriteFile(tmp, data, 0o644); err != nil {
			return err
		}
		if err := os.Rename(tmp, dest); err != nil {
			_ = os.Remove(tmp)
			// Windows/跨设备
			if err2 := os.WriteFile(dest, data, 0o644); err2 != nil {
				return err2
			}
		}
		n++
		return nil
	})
	if err != nil {
		return n, err
	}
	if stamp != "" {
		_ = os.WriteFile(stampPath, []byte(stamp), 0o644)
	}
	return n, nil
}

// Handler SPA 静态服务。
// diskFallback：可选磁盘目录（如 /app/static），embed 缺文件时回退，避免只更到一半。
// 关键：/assets/* 永不回退 HTML（否则 MIME=text/html 导致模块脚本失败）。
func Handler(diskFallback string) http.Handler {
	sub, err := FS()
	if err != nil {
		sub = nil
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		p := path.Clean("/" + r.URL.Path)
		if strings.HasPrefix(p, "/api/") || strings.HasPrefix(p, "/uploads/") {
			http.NotFound(w, r)
			return
		}
		if p == "/" || p == "/index.html" {
			serveIndex(w, r, sub, diskFallback)
			return
		}
		if p == "/favicon.ico" {
			if serveFile(w, r, sub, diskFallback, "favicon.svg", "image/svg+xml") {
				return
			}
			if serveFile(w, r, sub, diskFallback, "favicon.ico", "image/x-icon") {
				return
			}
			http.NotFound(w, r)
			return
		}

		rel := strings.TrimPrefix(p, "/")
		isAsset := strings.HasPrefix(rel, "assets/") || looksLikeStaticFile(rel)

		// 1) embed
		if sub != nil {
			if data, err := fs.ReadFile(sub, rel); err == nil {
				writeBytes(w, r, rel, data)
				return
			}
		}
		// 2) disk fallback
		if diskFallback != "" {
			full := filepath.Join(diskFallback, filepath.FromSlash(rel))
			cleanRoot := filepath.Clean(diskFallback)
			if strings.HasPrefix(filepath.Clean(full), cleanRoot) {
				if data, err := os.ReadFile(full); err == nil {
					writeBytes(w, r, rel, data)
					return
				}
			}
		}

		// 资产路径：绝不 SPA 回退（防止 JS/CSS 变成 text/html）；404 禁止被 CDN 长缓存
		if isAsset {
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			http.Error(w, "asset not found", http.StatusNotFound)
			return
		}
		// 前端路由：回退 index.html
		serveIndex(w, r, sub, diskFallback)
	})
}

func looksLikeStaticFile(rel string) bool {
	ext := strings.ToLower(path.Ext(rel))
	switch ext {
	case ".js", ".mjs", ".css", ".map", ".svg", ".png", ".jpg", ".jpeg",
		".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".json", ".txt", ".wasm":
		return true
	default:
		return false
	}
}

func contentType(rel string, data []byte) string {
	ext := strings.ToLower(path.Ext(rel))
	switch ext {
	case ".js", ".mjs":
		return "text/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".json":
		return "application/json; charset=utf-8"
	case ".wasm":
		return "application/wasm"
	case ".html":
		return "text/html; charset=utf-8"
	case ".map":
		return "application/json; charset=utf-8"
	}
	if t := mime.TypeByExtension(ext); t != "" {
		return t
	}
	return http.DetectContentType(data)
}

func writeBytes(w http.ResponseWriter, r *http.Request, rel string, data []byte) {
	ct := contentType(rel, data)
	w.Header().Set("Content-Type", ct)
	if strings.HasPrefix(rel, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else if strings.HasSuffix(rel, ".html") {
		w.Header().Set("Cache-Control", "no-cache")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}
	if r.Method == http.MethodHead {
		w.Header().Set("Content-Length", itoa(len(data)))
		w.WriteHeader(http.StatusOK)
		return
	}
	_, _ = w.Write(data)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func serveIndex(w http.ResponseWriter, r *http.Request, sub fs.FS, disk string) {
	if sub != nil {
		if data, err := fs.ReadFile(sub, "index.html"); err == nil {
			writeBytes(w, r, "index.html", data)
			return
		}
	}
	if disk != "" {
		if data, err := os.ReadFile(filepath.Join(disk, "index.html")); err == nil {
			writeBytes(w, r, "index.html", data)
			return
		}
	}
	http.NotFound(w, r)
}

func serveFile(w http.ResponseWriter, r *http.Request, sub fs.FS, disk, rel, fallbackCT string) bool {
	if sub != nil {
		if data, err := fs.ReadFile(sub, rel); err == nil {
			if fallbackCT != "" {
				w.Header().Set("Content-Type", fallbackCT)
			}
			writeBytes(w, r, rel, data)
			return true
		}
	}
	if disk != "" {
		if data, err := os.ReadFile(filepath.Join(disk, filepath.FromSlash(rel))); err == nil {
			if fallbackCT != "" {
				w.Header().Set("Content-Type", fallbackCT)
			}
			writeBytes(w, r, rel, data)
			return true
		}
	}
	return false
}
