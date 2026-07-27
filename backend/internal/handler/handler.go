package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/cardkey/cardkey/internal/app"
	"github.com/cardkey/cardkey/internal/domain"
	"github.com/cardkey/cardkey/internal/middleware"
	"github.com/cardkey/cardkey/internal/pkg/httpx"
	"github.com/cardkey/cardkey/internal/pkg/response"
	"github.com/go-chi/chi/v5"
)

type Handler struct {
	App *app.App
}

func (h *Handler) decode(r *http.Request, dst any) error {
	return httpx.DecodeJSON(r, dst, httpx.DefaultMaxBody)
}

func (h *Handler) setAuthCookie(w http.ResponseWriter, r *http.Request, token string) {
	// Secure：HTTPS 或反代 X-Forwarded-Proto=https；亦可 SECURE_COOKIE=true 强制
	secure := httpx.IsHTTPS(r) || h.App.SecureCookie
	http.SetCookie(w, &http.Cookie{
		Name:     "cardkey_token",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
		MaxAge:   int((24 * time.Hour).Seconds()),
	})
}

func (h *Handler) clearAuthCookie(w http.ResponseWriter, r *http.Request) {
	secure := httpx.IsHTTPS(r) || h.App.SecureCookie
	http.SetCookie(w, &http.Cookie{
		Name:     "cardkey_token",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

func (h *Handler) GetPublicConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.App.PublicConfig(r.Context())
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, cfg)
}

// FaviconRedirect 浏览器默认请求 /favicon.ico 时跳转到系统设置中的图标。
func (h *Handler) FaviconRedirect(w http.ResponseWriter, r *http.Request) {
	s, err := h.App.GetSettings(r.Context())
	target := "/favicon.svg"
	if err == nil {
		fav := strings.TrimSpace(s.SiteFavicon)
		if fav != "" {
			// data URL 无法作为 Location；回退 svg
			if !strings.HasPrefix(fav, "data:") {
				target = fav
			}
		}
	}
	// 相对路径保持同源
	http.Redirect(w, r, target, http.StatusFound)
}

func (h *Handler) SetupStatus(w http.ResponseWriter, r *http.Request) {
	st, err := h.App.GetSetupStatus(r.Context())
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, st)
}

func (h *Handler) CompleteSetup(w http.ResponseWriter, r *http.Request) {
	var in app.SetupInput
	if err := h.decode(r, &in); err != nil {
		response.Fail(w, err)
		return
	}
	user, token, err := h.App.CompleteSetup(r.Context(), in, middleware.ClientIP(r))
	if err != nil {
		response.Fail(w, err)
		return
	}
	if token != "" {
		h.setAuthCookie(w, r, token)
	}
	response.OK(w, user)
}

func (h *Handler) Redeem(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Category string `json:"category"`
		Code     string `json:"code"`
	}
	if err := h.decode(r, &in); err != nil {
		response.Fail(w, err)
		return
	}
	apiKey := middleware.BearerToken(r)
	res, err := h.App.Redeem(r.Context(), in.Category, in.Code, middleware.ClientIP(r), r.UserAgent(), apiKey)
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

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := h.decode(r, &in); err != nil {
		response.Fail(w, err)
		return
	}
	user, token, err := h.App.Login(r.Context(), in.Username, in.Password, middleware.ClientIP(r))
	if err != nil {
		response.Fail(w, err)
		return
	}
	h.App.IncLogin()
	h.setAuthCookie(w, r, token)
	response.OK(w, user)
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if raw := middleware.JWTRaw(r.Context()); raw != "" {
		h.App.RevokeJWT(r.Context(), raw)
	} else if t := middleware.BearerToken(r); t != "" {
		h.App.RevokeJWT(r.Context(), t)
	} else if c, err := r.Cookie("cardkey_token"); err == nil && c.Value != "" {
		h.App.RevokeJWT(r.Context(), c.Value)
	}
	h.clearAuthCookie(w, r)
	response.OK(w, nil)
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	id := middleware.AdminID(r.Context())
	user, err := h.App.Me(r.Context(), id)
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, user)
}

func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
		// camelCase 兼容
		OldPassword2 string `json:"oldPassword"`
		NewPassword2 string `json:"newPassword"`
	}
	if err := h.decode(r, &in); err != nil {
		response.Fail(w, err)
		return
	}
	oldP := in.OldPassword
	if oldP == "" {
		oldP = in.OldPassword2
	}
	newP := in.NewPassword
	if newP == "" {
		newP = in.NewPassword2
	}
	if err := h.App.ChangePassword(r.Context(), middleware.AdminID(r.Context()), oldP, newP); err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, nil)
}

func (h *Handler) Dashboard(w http.ResponseWriter, r *http.Request) {
	s, err := h.App.Dashboard(r.Context())
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, s)
}

func (h *Handler) ListCategories(w http.ResponseWriter, r *http.Request) {
	list, err := h.App.ListCategories(r.Context())
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, list)
}

func (h *Handler) CreateCategory(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        string             `json:"name"`
		Slug        string             `json:"slug"`
		CodePrefix  string             `json:"codePrefix"`
		Description string             `json:"description"`
		Icon        domain.CategoryIcon `json:"icon"`
	}
	if err := h.decode(r, &in); err != nil {
		response.Fail(w, err)
		return
	}
	cat, err := h.App.CreateCategory(r.Context(), in.Name, in.Slug, in.CodePrefix, in.Description, in.Icon,
		middleware.Username(r.Context()), middleware.ClientIP(r))
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, cat)
}

func (h *Handler) UpdateCategory(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var in map[string]any
	if err := h.decode(r, &in); err != nil {
		response.Fail(w, err)
		return
	}
	var name, desc *string
	var enabled *bool
	var sort *int
	var icon *domain.CategoryIcon
	if v, ok := in["name"].(string); ok {
		name = &v
	}
	if v, ok := in["description"].(string); ok {
		desc = &v
	}
	if v, ok := in["enabled"].(bool); ok {
		enabled = &v
	}
	if v, ok := in["sortOrder"].(float64); ok {
		i := int(v)
		sort = &i
	}
	if raw, ok := in["icon"].(map[string]any); ok {
		ic := domain.CategoryIcon{}
		if k, ok := raw["kind"].(string); ok {
			ic.Kind = k
		}
		if v, ok := raw["value"].(string); ok {
			ic.Value = v
		}
		icon = &ic
	}
	cat, err := h.App.UpdateCategory(r.Context(), id, name, desc, enabled, sort, icon,
		middleware.Username(r.Context()), middleware.ClientIP(r))
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, cat)
}

func (h *Handler) DeleteCategory(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.App.DeleteCategory(r.Context(), id, middleware.Username(r.Context()), middleware.ClientIP(r)); err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, nil)
}

func (h *Handler) ListCards(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	ps, _ := strconv.Atoi(q.Get("page_size"))
	res, err := h.App.ListCards(r.Context(), page, ps, q.Get("status"), q.Get("q"), q.Get("category"), q.Get("batch_id"))
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, res)
}

func (h *Handler) GetCard(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	reveal := r.URL.Query().Get("reveal") == "1"
	card, err := h.App.GetCard(r.Context(), id, reveal, middleware.Username(r.Context()), middleware.ClientIP(r))
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, card)
}

func (h *Handler) CreateCard(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Content    string          `json:"content"`
		Type       domain.CardType `json:"type"`
		Note       string          `json:"note"`
		BatchID    *string         `json:"batchId"`
		CategoryID string          `json:"categoryId"`
	}
	if err := h.decode(r, &in); err != nil {
		response.Fail(w, err)
		return
	}
	card, err := h.App.CreateCard(r.Context(), in.CategoryID, in.Content, in.Type, in.Note, in.BatchID,
		middleware.Username(r.Context()), middleware.ClientIP(r))
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, card)
}

func (h *Handler) ImportCards(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Raw        string          `json:"raw"`
		Type       domain.CardType `json:"type"`
		CategoryID string          `json:"categoryId"`
		BatchName  string          `json:"batchName"`
		Note       string          `json:"note"`
	}
	if err := h.decode(r, &in); err != nil {
		response.Fail(w, err)
		return
	}
	res, err := h.App.ImportCards(r.Context(), in.CategoryID, in.Raw, in.Type, in.BatchName, in.Note,
		middleware.Username(r.Context()), middleware.ClientIP(r))
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, res)
}

func (h *Handler) BatchAction(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs    []string `json:"ids"`
		Action string   `json:"action"`
	}
	if err := h.decode(r, &in); err != nil {
		response.Fail(w, err)
		return
	}
	n, err := h.App.BatchAction(r.Context(), in.IDs, in.Action, middleware.Username(r.Context()), middleware.ClientIP(r))
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, n)
}

func (h *Handler) ListBatches(w http.ResponseWriter, r *http.Request) {
	list, err := h.App.ListBatches(r.Context(), r.URL.Query().Get("category"))
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, list)
}

func (h *Handler) DeleteBatch(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.App.DeleteBatch(r.Context(), id, middleware.Username(r.Context()), middleware.ClientIP(r)); err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, nil)
}

func (h *Handler) ListRedeems(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	ps, _ := strconv.Atoi(q.Get("page_size"))
	res, err := h.App.ListRedeems(r.Context(), page, ps, q.Get("q"), q.Get("category"))
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, res)
}

func (h *Handler) ListAPIKeys(w http.ResponseWriter, r *http.Request) {
	list, err := h.App.ListAPIKeys(r.Context())
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, list)
}

func (h *Handler) CreateAPIKey(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name         string   `json:"name"`
		Scopes       []string `json:"scopes"`
		RateLimitRpm *int     `json:"rateLimitRpm"`
	}
	if err := h.decode(r, &in); err != nil {
		response.Fail(w, err)
		return
	}
	meta, plain, err := h.App.CreateAPIKey(r.Context(), in.Name, in.Scopes, in.RateLimitRpm,
		middleware.Username(r.Context()), middleware.ClientIP(r))
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, map[string]any{"key": meta, "plaintext": plain})
}

func (h *Handler) RevokeAPIKey(w http.ResponseWriter, r *http.Request) {
	if err := h.App.RevokeAPIKey(r.Context(), chi.URLParam(r, "id"), middleware.Username(r.Context()), middleware.ClientIP(r)); err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, nil)
}

func (h *Handler) DeleteAPIKey(w http.ResponseWriter, r *http.Request) {
	if err := h.App.DeleteAPIKey(r.Context(), chi.URLParam(r, "id"), middleware.Username(r.Context()), middleware.ClientIP(r)); err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, nil)
}

func (h *Handler) RotateAPIKey(w http.ResponseWriter, r *http.Request) {
	meta, plain, err := h.App.RotateAPIKey(r.Context(), chi.URLParam(r, "id"), middleware.Username(r.Context()), middleware.ClientIP(r))
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, map[string]any{"key": meta, "plaintext": plain})
}

func (h *Handler) SetPublicRedeemKey(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Mode      string `json:"mode"`
		CustomKey string `json:"customKey"`
	}
	if err := h.decode(r, &in); err != nil {
		response.Fail(w, err)
		return
	}
	plain, err := h.App.SetPublicRedeemKey(r.Context(), in.Mode, in.CustomKey, middleware.Username(r.Context()), middleware.ClientIP(r))
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, map[string]any{"plaintext": plain})
}

func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	s, err := h.App.GetSettings(r.Context())
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, s)
}

func (h *Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var s domain.Settings
	if err := h.decode(r, &s); err != nil {
		response.Fail(w, err)
		return
	}
	out, err := h.App.UpdateSettings(r.Context(), s, middleware.Username(r.Context()), middleware.ClientIP(r))
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, out)
}

func (h *Handler) ListAudit(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	ps, _ := strconv.Atoi(q.Get("page_size"))
	res, err := h.App.ListAudit(r.Context(), page, ps)
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, res)
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	response.OK(w, map[string]string{"status": "ok"})
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

func (h *Handler) UploadImage(w http.ResponseWriter, r *http.Request) {
	url, err := h.App.UploadImage(r.Context(), r, middleware.Username(r.Context()), middleware.ClientIP(r))
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, map[string]string{"url": url})
}

func (h *Handler) CheckUpdates(w http.ResponseWriter, r *http.Request) {
	res, err := h.App.CheckUpdates(r.Context())
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, res)
}

func (h *Handler) UpdateHistory(w http.ResponseWriter, r *http.Request) {
	list, err := h.App.ListUpdateHistory()
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
	response.OK(w, map[string]string{"status": "restarting"})
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
}

// silence unused in some builds
var _ = strings.TrimSpace
