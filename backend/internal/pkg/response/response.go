package response

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/cardkey/cardkey/internal/pkg/apperr"
)

type envelope struct {
	Success bool           `json:"success"`
	Data    any            `json:"data,omitempty"`
	Error   *errBody       `json:"error,omitempty"`
	Meta    map[string]any `json:"meta,omitempty"`
}

type errBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func OK(w http.ResponseWriter, data any) {
	writeJSON(w, http.StatusOK, envelope{Success: true, Data: data})
}

func OKMeta(w http.ResponseWriter, data any, meta map[string]any) {
	writeJSON(w, http.StatusOK, envelope{Success: true, Data: data, Meta: meta})
}

func Fail(w http.ResponseWriter, err error) {
	if e, ok := apperr.As(err); ok {
		writeJSON(w, e.HTTPStatus, envelope{
			Success: false,
			Error:   &errBody{Code: e.Code, Message: e.Message},
		})
		return
	}
	// 非业务错误：记日志，对外统一文案
	reqID := w.Header().Get("X-Request-Id")
	slog.Error("internal error", "err", err, "requestId", reqID)
	writeJSON(w, http.StatusInternalServerError, envelope{
		Success: false,
		Error:   &errBody{Code: "INTERNAL_ERROR", Message: "内部错误"},
	})
}
