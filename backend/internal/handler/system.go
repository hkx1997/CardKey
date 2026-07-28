package handler

import (
	"net/http"

	"github.com/cardkey/cardkey/internal/pkg/response"
	"github.com/cardkey/cardkey/internal/version"
)

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	// 附带版本，便于确认一键更新是否真的切到新二进制（不查库）
	response.OK(w, map[string]string{
		"status":  "ok",
		"version": version.Version,
		"commit":  version.Commit,
	})
}

func (h *Handler) Ready(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := h.App.Ready(ctx); err != nil {
		h.App.Log.Warn("ready check failed", "err", err)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"success":false,"error":{"code":"NOT_READY","message":"依赖服务不可用"}}`))
		return
	}
	response.OK(w, map[string]string{"status": "ready"})
}

func (h *Handler) SystemInfo(w http.ResponseWriter, r *http.Request) {
	response.OK(w, h.App.SystemInfo(r.Context()))
}

// ReconcileStock 手动触发类别 unused_count 全量对账。
func (h *Handler) ReconcileStock(w http.ResponseWriter, r *http.Request) {
	// 先跑过期，再对账，与后台周期任务一致
	expired, err := h.App.MarkExpiredCards(r.Context())
	if err != nil {
		response.Fail(w, err)
		return
	}
	n, err := h.App.ReconcileCategoryStock(r.Context())
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, map[string]any{
		"correctedCategories": n,
		"expiredMarked":       expired,
	})
}
