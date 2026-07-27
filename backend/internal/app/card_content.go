package app

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/cardkey/cardkey/internal/domain"
	"github.com/cardkey/cardkey/internal/pkg/apperr"
)

// CreateCardPayload 创建卡密时的内容载荷
type CreateCardPayload struct {
	CategoryID      string
	Type            domain.CardType
	Content         string // utf8 或 base64
	ContentEncoding string // "" | utf8 | base64
	Filename        string
	Mime            string
	Note            string
	BatchID         *string
}

func normalizeCardType(t domain.CardType) domain.CardType {
	t = domain.CardType(strings.ToLower(strings.TrimSpace(string(t))))
	switch t {
	case domain.TypeText, domain.TypeTXT, domain.TypeJSON, domain.TypeAccount,
		domain.TypeImage, domain.TypeZip, domain.TypePDF, domain.TypeFile:
		return t
	case "":
		return domain.TypeText
	default:
		// 未知类型按通用文件
		return domain.TypeFile
	}
}

func defaultMimeForType(t domain.CardType) string {
	switch t {
	case domain.TypeJSON:
		return "application/json"
	case domain.TypeTXT, domain.TypeText, domain.TypeAccount:
		return "text/plain; charset=utf-8"
	case domain.TypeImage:
		return "application/octet-stream"
	case domain.TypeZip:
		return "application/zip"
	case domain.TypePDF:
		return "application/pdf"
	default:
		return "application/octet-stream"
	}
}

func defaultFilename(t domain.CardType, code string) string {
	base := strings.ReplaceAll(code, "/", "_")
	if base == "" {
		base = "content"
	}
	switch t {
	case domain.TypeJSON:
		return base + ".json"
	case domain.TypeTXT, domain.TypeText, domain.TypeAccount:
		return base + ".txt"
	case domain.TypeZip:
		return base + ".zip"
	case domain.TypePDF:
		return base + ".pdf"
	case domain.TypeImage:
		return base + ".bin"
	default:
		return base + ".bin"
	}
}

func sniffMime(data []byte, fallback string) string {
	if len(data) == 0 {
		return fallback
	}
	ct := http.DetectContentType(data)
	if ct == "" || ct == "application/octet-stream" {
		return fallback
	}
	return ct
}

func refineTypeFromMime(t domain.CardType, mime, filename string) domain.CardType {
	m := strings.ToLower(mime)
	ext := strings.ToLower(filepath.Ext(filename))
	if strings.HasPrefix(m, "image/") || ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".gif" || ext == ".webp" || ext == ".bmp" {
		return domain.TypeImage
	}
	if m == "application/pdf" || ext == ".pdf" {
		return domain.TypePDF
	}
	if m == "application/zip" || m == "application/x-zip-compressed" ||
		ext == ".zip" || ext == ".rar" || ext == ".7z" || ext == ".tar" || ext == ".gz" || ext == ".tgz" {
		return domain.TypeZip
	}
	if t == domain.TypeFile || t == domain.TypeImage || t == domain.TypeZip || t == domain.TypePDF {
		return t
	}
	return t
}

// resolveCreateBytes 解析创建请求中的明文内容
func resolveCreateBytes(in CreateCardPayload) (raw []byte, typ domain.CardType, filename, mime string, err error) {
	typ = normalizeCardType(in.Type)
	filename = strings.TrimSpace(in.Filename)
	mime = strings.TrimSpace(in.Mime)
	enc := strings.ToLower(strings.TrimSpace(in.ContentEncoding))
	if enc == "" {
		if domain.IsBinaryCardType(typ) {
			enc = "base64"
		} else {
			enc = "utf8"
		}
	}

	switch enc {
	case "base64", "b64":
		s := strings.TrimSpace(in.Content)
		// data URL
		if i := strings.Index(s, ";base64,"); i >= 0 {
			s = s[i+8:]
		} else if strings.HasPrefix(s, "data:") {
			if j := strings.Index(s, ","); j >= 0 {
				s = s[j+1:]
			}
		}
		raw, err = base64.StdEncoding.DecodeString(s)
		if err != nil {
			// 尝试 RawStd
			raw, err = base64.RawStdEncoding.DecodeString(s)
			if err != nil {
				return nil, typ, "", "", apperr.Validation("内容不是合法 Base64（文件类型请上传文件或传 base64）")
			}
		}
	case "utf8", "text", "":
		if strings.TrimSpace(in.Content) == "" && !domain.IsBinaryCardType(typ) {
			return nil, typ, "", "", apperr.Validation("请输入卡密内容")
		}
		if !utf8.ValidString(in.Content) {
			return nil, typ, "", "", apperr.Validation("文本内容须为 UTF-8")
		}
		raw = []byte(in.Content)
	default:
		return nil, typ, "", "", apperr.Validation("contentEncoding 仅支持 utf8 或 base64")
	}

	if len(raw) == 0 {
		return nil, typ, "", "", apperr.Validation("卡密内容不能为空")
	}
	if len(raw) > domain.MaxCardContentBytes {
		return nil, typ, "", "", apperr.Validation("卡密内容不能超过 5MB")
	}

	if domain.IsTextCardType(typ) {
		if typ == domain.TypeJSON {
			if !json.Valid(raw) {
				return nil, typ, "", "", apperr.Validation("JSON 格式无效")
			}
			if mime == "" {
				mime = "application/json"
			}
		} else if mime == "" {
			mime = defaultMimeForType(typ)
		}
		if filename == "" {
			filename = defaultFilename(typ, "content")
		}
		return raw, typ, filename, mime, nil
	}

	// 二进制
	if mime == "" {
		mime = sniffMime(raw, defaultMimeForType(typ))
	}
	if typ == domain.TypeFile || typ == domain.TypeImage || typ == domain.TypeZip || typ == domain.TypePDF {
		typ = refineTypeFromMime(typ, mime, filename)
	}
	if filename == "" {
		filename = defaultFilename(typ, "download")
		// 按 mime 修正扩展名
		if typ == domain.TypeImage {
			switch {
			case strings.Contains(mime, "png"):
				filename = "image.png"
			case strings.Contains(mime, "jpeg"), strings.Contains(mime, "jpg"):
				filename = "image.jpg"
			case strings.Contains(mime, "gif"):
				filename = "image.gif"
			case strings.Contains(mime, "webp"):
				filename = "image.webp"
			}
		}
	}
	filename = filepath.Base(filename)
	if filename == "." || filename == "/" || filename == "" {
		filename = defaultFilename(typ, "download")
	}
	return raw, typ, filename, mime, nil
}

func packPayloadForAPI(typ domain.CardType, raw []byte, filename, mime string, size int64) (content, encoding string) {
	if domain.IsBinaryCardType(typ) {
		return base64.StdEncoding.EncodeToString(raw), "base64"
	}
	return string(raw), "utf8"
}

func fillContentMeta(typ domain.CardType, filename, mime string, size int64) (string, string, int64) {
	if mime == "" {
		mime = defaultMimeForType(typ)
	}
	if filename == "" {
		filename = defaultFilename(typ, "content")
	}
	if size < 0 {
		size = 0
	}
	return filename, mime, size
}
