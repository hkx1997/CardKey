package httpx

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"

	"github.com/cardkey/cardkey/internal/pkg/apperr"
)

const DefaultMaxBody = 12 << 20 // 12 MiB（卡密文件 base64 / 批量导入）

// DecodeJSON 限制 body 大小并解析 JSON（禁止未知字段）。
func DecodeJSON(r *http.Request, dst any, maxBytes int64) error {
	if maxBytes <= 0 {
		maxBytes = DefaultMaxBody
	}
	r.Body = http.MaxBytesReader(nil, r.Body, maxBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		if err == io.EOF {
			return apperr.Validation("请求体为空")
		}
		var maxErr *http.MaxBytesError
		if ok := errorAsMaxBytes(err, &maxErr); ok {
			return apperr.Validation("请求体过大")
		}
		return apperr.Validation("请求体无效")
	}
	// 拒绝尾部多余 JSON
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return apperr.Validation("请求体无效")
	}
	return nil
}

func errorAsMaxBytes(err error, target **http.MaxBytesError) bool {
	if err == nil {
		return false
	}
	if e, ok := err.(*http.MaxBytesError); ok {
		*target = e
		return true
	}
	// wrapped
	type unwrapper interface{ Unwrap() error }
	if u, ok := err.(unwrapper); ok {
		return errorAsMaxBytes(u.Unwrap(), target)
	}
	return false
}

// ClientIP 提取客户端 IP。trustProxy 为真时才信任 X-Forwarded-For / X-Real-IP。
func ClientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			ip := strings.TrimSpace(parts[0])
			if ip != "" {
				return ip
			}
		}
		if xr := strings.TrimSpace(r.Header.Get("X-Real-IP")); xr != "" {
			return xr
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// IsHTTPS 判断请求是否经 HTTPS（含反代）。
func IsHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}
