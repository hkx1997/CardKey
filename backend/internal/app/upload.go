package app

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/cardkey/cardkey/internal/pkg/apperr"
	"github.com/google/uuid"
)

const maxUploadBytes = 2 << 20 // 2 MiB

// 禁止 SVG（可内嵌脚本，存储型 XSS）；仅允许光栅图与 ICO
var allowedImageTypes = map[string]string{
	"image/png":                ".png",
	"image/jpeg":               ".jpg",
	"image/gif":                ".gif",
	"image/webp":               ".webp",
	"image/x-icon":             ".ico",
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

	// 仅信任 magic-bytes 嗅探，禁止扩展名/客户端 Content-Type 兜底（防 polyglot）
	buf := make([]byte, 512)
	n, _ := io.ReadFull(file, buf)
	if n < 12 {
		return "", apperr.Validation("文件过小或无法识别")
	}
	// 显式拒绝 SVG 特征
	head := strings.ToLower(string(buf[:n]))
	if strings.Contains(head, "<svg") || strings.Contains(head, "<?xml") {
		return "", apperr.Validation("出于安全考虑不支持 SVG，请使用 PNG / JPEG / WebP / ICO")
	}
	ct := http.DetectContentType(buf[:n])
	ext, ok := allowedImageTypes[ct]
	if !ok {
		// ICO 部分环境被嗅探为 octet-stream：检查魔数 00 00 01 00
		if n >= 4 && buf[0] == 0 && buf[1] == 0 && buf[2] == 1 && buf[3] == 0 {
			ext, ok = ".ico", true
		}
	}
	if !ok {
		return "", apperr.Validation("仅支持 PNG / JPEG / GIF / WebP / ICO（按文件内容识别，勿改扩展名）")
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
