package handler

import (
	"net/http"

	"github.com/cardkey/cardkey/internal/middleware"
	"github.com/cardkey/cardkey/internal/pkg/response"
)

func (h *Handler) CheckUpdates(w http.ResponseWriter, r *http.Request) {
	force := r.URL.Query().Get("force") == "1" || r.URL.Query().Get("force") == "true"
	res, err := h.App.CheckUpdatesOpt(r.Context(), force)
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, res)
}

func (h *Handler) UpdateHistory(w http.ResponseWriter, r *http.Request) {
	list, err := h.App.ListUpdateHistory(r.Context())
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, list)
}

func (h *Handler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	response.OK(w, h.App.GetUpdateStatus())
}

func (h *Handler) ApplyUpdate(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Version string `json:"version"`
	}
	_ = h.decode(r, &in)
	if err := h.App.ApplyUpdate(r.Context(), in.Version, middleware.Username(r.Context()), middleware.ClientIP(r)); err != nil {
		response.Fail(w, err)
		return
	}
	// 立即写出并 flush，避免进程即将退出时响应滞留在缓冲里
	response.OK(w, map[string]string{"status": "restarting"})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

func (h *Handler) RollbackUpdate(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Version string `json:"version"`
	}
	_ = h.decode(r, &in)
	if err := h.App.RollbackUpdate(r.Context(), in.Version, middleware.Username(r.Context()), middleware.ClientIP(r)); err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, map[string]string{"status": "restarting"})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}
