package handler

import (
	"net/http"
	"strings"

	"github.com/cardkey/cardkey/internal/middleware"
	"github.com/cardkey/cardkey/internal/pkg/response"
)

func (h *Handler) Redeem(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Category       string `json:"category"`
		Code           string `json:"code"`
		CaptchaToken   string `json:"captchaToken"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if err := h.decode(r, &in); err != nil {
		response.Fail(w, err)
		return
	}
	// 优先 header：Idempotency-Key（RFC 风格）
	idem := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idem == "" {
		idem = strings.TrimSpace(in.IdempotencyKey)
	}
	apiKey := middleware.BearerToken(r)
	res, err := h.App.RedeemWithIdempotency(
		r.Context(), in.Category, in.Code, middleware.ClientIP(r), r.UserAgent(), apiKey, in.CaptchaToken, idem)
	if err != nil {
		h.App.IncRedeemErr()
		response.Fail(w, err)
		return
	}
	if res.Status == "success" {
		h.App.IncRedeemOK()
	}
	response.OK(w, res)
}
