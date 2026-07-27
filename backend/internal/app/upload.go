package app

import (
	"context"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/cardkey/cardkey/internal/pkg/apperr"
	"github.com/google/uuid"
)

const maxUploadBytes = 2 << 20 // 2 MiB

var allowedImageTypes = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/gif":  ".gif",
	"image/webp": ".webp",
	"image/svg+xml": ".svg",
	"image/x-icon":  ".ico",
	"image/vnd.microsoft.icon": ".ico",
}

// UploadImage 保存上传图片到 DataDir/uploads，返回可公开访问路径 /uploads/xxx.ext
func (a *App) UploadImage(ctx context.Context, r *http.Request, actor, ip string) (string, error) {
	if a.DataDir == "" {
		return "", apperr.Internal("未配置数据目录")
	}
	if err := r.ParseMultipartForm(maxUploadBytes + 512); err != nil {
		return "", apperr.Validation("无法解析上传文件（最大 2MB）")
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		return "", apperr.Validation("请选择图片文件（字段名 file）")
	}
	defer file.Close()

	if hdr.Size > maxUploadBytes {
		return "", apperr.Validation("图片不能超过 2MB")
	}

	// 嗅探 MIME
	buf := make([]byte, 512)
	n, _ := io.ReadFull(file, buf)
	ct := http.DetectContentType(buf[:n])
	// SVG 检测较弱，回退 header
	if ct == "text/plain; charset=utf-8" || ct == "application/octet-stream" {
		if mt, _, _ := mime.ParseMediaType(hdr.Header.Get("Content-Type")); mt != "" {
			ct = mt
		}
	}
	ext, ok := allowedImageTypes[ct]
	if !ok {
		// 按扩展名兜底
		nameExt := strings.ToLower(filepath.Ext(hdr.Filename))
		switch nameExt {
		case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico":
			if nameExt == ".jpeg" {
				ext = ".jpg"
			} else {
				ext = nameExt
			}
			ok = true
		}
	}
	if !ok {
		return "", apperr.Validation("仅支持 PNG / JPEG / GIF / WebP / SVG / ICO")
	}

	dir := filepath.Join(a.DataDir, "uploads")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", apperr.Internal("无法创建上传目录")
	}
	fname := fmt.Sprintf("%s_%d%s", uuid.NewString()[:8], time.Now().Unix(), ext)
	dest := filepath.Join(dir, fname)

	out, err := os.Create(dest)
	if err != nil {
		return "", apperr.Internal("写入失败")
	}
	defer out.Close()
	// 写回嗅探字节 + 剩余内容
	if _, err := out.Write(buf[:n]); err != nil {
		return "", err
	}
	if _, err := io.Copy(out, io.LimitReader(file, maxUploadBytes)); err != nil {
		return "", err
	}

	urlPath := "/uploads/" + fname
	a.Audit(ctx, "admin", actor, "upload_image", "upload:"+fname, hdr.Filename, ip)
	return urlPath, nil
}
