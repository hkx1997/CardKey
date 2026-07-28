package handler

import (
	"net/http"

	"github.com/cardkey/cardkey/internal/middleware"
	"github.com/cardkey/cardkey/internal/pkg/response"
)

func (h *Handler) Redeem(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Category     string `json:"category"`
		Code         string `json:"code"`
		CaptchaToken string `json:"captchaToken"`
	}
	if err := h.decode(r, &in); err != nil {
		response.Fail(w, err)
		return
	}
	apiKey := middleware.BearerToken(r)
	res, err := h.App.Redeem(r.Context(), in.Category, in.Code, middleware.ClientIP(r), r.UserAgent(), apiKey, in.CaptchaToken)
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
