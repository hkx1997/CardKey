package handler

import (
	"encoding/base64"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/cardkey/cardkey/internal/app"
	"github.com/cardkey/cardkey/internal/domain"
	"github.com/cardkey/cardkey/internal/middleware"
	"github.com/cardkey/cardkey/internal/openapi"
	"github.com/cardkey/cardkey/internal/pkg/apperr"
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
	secure := httpx.IsHTTPS(r, h.App.TrustProxy) || h.App.SecureCookie
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
	secure := httpx.IsHTTPS(r, h.App.TrustProxy) || h.App.SecureCookie
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

func (h *Handler) GetPublicCategoryStock(w http.ResponseWriter, r *http.Request) {
	stock, err := h.App.PublicCategoryStock(r.Context())
	if err != nil {
		response.Fail(w, err)
		return
	}
	etag := app.PublicStockETag(stock)
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
	// 协商缓存：库存未变时 304，减流量
	if inm := strings.TrimSpace(r.Header.Get("If-None-Match")); inm != "" && inm == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	response.OK(w, stock)
}

// FaviconRedirect 浏览器默认请求 /favicon.ico 时跳转到系统设置中的图标。
// 仅允许同源相对路径（/uploads/… 或 /favicon.svg），禁止 open redirect。
func (h *Handler) FaviconRedirect(w http.ResponseWriter, r *http.Request) {
	s, err := h.App.GetSettings(r.Context())
	target := "/favicon.svg"
	if err == nil {
		fav := strings.TrimSpace(s.SiteFavicon)
		if fav != "" && safeSameOriginPath(fav) {
			target = fav
		}
	}
	http.Redirect(w, r, target, http.StatusFound)
}

func safeSameOriginPath(p string) bool {
	p = strings.TrimSpace(p)
	if p == "" || strings.HasPrefix(p, "data:") {
		return false
	}
	// 禁止协议相对 //evil 与绝对 URL
	if strings.HasPrefix(p, "//") || strings.Contains(p, "://") {
		return false
	}
	if !strings.HasPrefix(p, "/") {
		return false
	}
	// 仅站内静态资源路径
	if strings.HasPrefix(p, "/uploads/") || p == "/favicon.svg" || strings.HasPrefix(p, "/assets/") {
		return true
	}
	// 其它以 / 开头的相对路径也允许（同源），但拒绝 \ 与控制字符
	if strings.ContainsAny(p, "\\\r\n\t") {
		return false
	}
	return true
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

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := h.decode(r, &in); err != nil {
		response.Fail(w, err)
		return
	}
	res, err := h.App.LoginStep(r.Context(), in.Username, in.Password, middleware.ClientIP(r))
	if err != nil {
		response.Fail(w, err)
		return
	}
	if res.RequiresTOTP {
		response.OK(w, map[string]any{
			"requiresTotp": true,
			"ticket":       res.Ticket,
			"user":         res.User,
		})
		return
	}
	h.App.IncLogin()
	h.setAuthCookie(w, r, res.Token)
	response.OK(w, res.User)
}

func (h *Handler) LoginTOTP(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Ticket string `json:"ticket"`
		Code   string `json:"code"`
	}
	if err := h.decode(r, &in); err != nil {
		response.Fail(w, err)
		return
	}
	user, token, err := h.App.CompleteLoginTOTP(r.Context(), in.Ticket, in.Code, middleware.ClientIP(r))
	if err != nil {
		response.Fail(w, err)
		return
	}
	h.App.IncLogin()
	h.setAuthCookie(w, r, token)
	response.OK(w, user)
}

func (h *Handler) BeginTOTPSetup(w http.ResponseWriter, r *http.Request) {
	id := middleware.AdminID(r.Context())
	user, err := h.App.Me(r.Context(), id)
	if err != nil {
		response.Fail(w, err)
		return
	}
	secret, uri, err := h.App.BeginTOTPSetup(r.Context(), id, user.Username)
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, map[string]string{"secret": secret, "otpauthUri": uri})
}

func (h *Handler) ConfirmTOTPSetup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Code string `json:"code"`
	}
	if err := h.decode(r, &in); err != nil {
		response.Fail(w, err)
		return
	}
	if err := h.App.ConfirmTOTPSetup(r.Context(), middleware.AdminID(r.Context()), in.Code); err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, map[string]bool{"totpEnabled": true})
}

func (h *Handler) DisableTOTP(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Code string `json:"code"`
	}
	if err := h.decode(r, &in); err != nil {
		response.Fail(w, err)
		return
	}
	if err := h.App.DisableTOTP(r.Context(), middleware.AdminID(r.Context()), in.Code); err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, map[string]bool{"totpEnabled": false})
}

func (h *Handler) ImportCardsAsync(w http.ResponseWriter, r *http.Request) {
	var in struct {
		CategoryID string `json:"categoryId"`
		Content    string `json:"content"`
		Type       string `json:"type"`
		BatchName  string `json:"batchName"`
		Note       string `json:"note"`
	}
	if err := h.decode(r, &in); err != nil {
		response.Fail(w, err)
		return
	}
	job, err := h.App.EnqueueImportJob(r.Context(), in.CategoryID, in.Content, domain.CardType(in.Type), in.BatchName, in.Note, middleware.Username(r.Context()))
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, job)
}

func (h *Handler) GetImportJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	job, err := h.App.GetImportJob(r.Context(), id)
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, job)
}

func (h *Handler) ListImportJobs(w http.ResponseWriter, r *http.Request) {
	list, err := h.App.ListImportJobs(r.Context(), 20)
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, list)
}

func (h *Handler) OpenAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(openapi.JSON)
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

func (h *Handler) RuntimeMetrics(w http.ResponseWriter, r *http.Request) {
	response.OK(w, h.App.RuntimeMetrics(r.Context()))
}

func (h *Handler) ListCategories(w http.ResponseWriter, r *http.Request) {
	light := r.URL.Query().Get("light") == "1" || r.URL.Query().Get("light") == "true"
	var list []domain.Category
	var err error
	if light {
		list, err = h.App.ListCategoriesLight(r.Context())
	} else {
		list, err = h.App.ListCategories(r.Context())
	}
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
	wantExact := q.Get("exact_total") == "1" || q.Get("exact") == "1"
	res, err := h.App.ListCards(r.Context(), page, ps, q.Get("status"), q.Get("q"), q.Get("category"), q.Get("batch_id"), q.Get("cursor"), wantExact)
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
	// multipart：文件卡密（image/zip/pdf/file）
	ct := r.Header.Get("Content-Type")
	if strings.HasPrefix(ct, "multipart/form-data") {
		h.createCardMultipart(w, r)
		return
	}
	var in struct {
		Content         string          `json:"content"`
		ContentEncoding string          `json:"contentEncoding"`
		Filename        string          `json:"filename"`
		Mime            string          `json:"mime"`
		Type            domain.CardType `json:"type"`
		Note            string          `json:"note"`
		BatchID         *string         `json:"batchId"`
		CategoryID      string          `json:"categoryId"`
	}
	if err := h.decode(r, &in); err != nil {
		response.Fail(w, err)
		return
	}
	card, err := h.App.CreateCardWithPayload(r.Context(), app.CreateCardPayload{
		CategoryID:      in.CategoryID,
		Type:            in.Type,
		Content:         in.Content,
		ContentEncoding: in.ContentEncoding,
		Filename:        in.Filename,
		Mime:            in.Mime,
		Note:            in.Note,
		BatchID:         in.BatchID,
	}, middleware.Username(r.Context()), middleware.ClientIP(r))
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, card)
}

func (h *Handler) createCardMultipart(w http.ResponseWriter, r *http.Request) {
	const maxMem = 6 << 20
	if err := r.ParseMultipartForm(maxMem); err != nil {
		response.Fail(w, apperr.Validation("无法解析上传（单文件最大 5MB）"))
		return
	}
	categoryID := strings.TrimSpace(r.FormValue("categoryId"))
	typ := domain.CardType(strings.TrimSpace(r.FormValue("type")))
	note := r.FormValue("note")
	var batchID *string
	if b := strings.TrimSpace(r.FormValue("batchId")); b != "" {
		batchID = &b
	}

	file, hdr, err := r.FormFile("file")
	if err != nil {
		// 允许纯文本字段 content（兼容）
		content := r.FormValue("content")
		card, err2 := h.App.CreateCardWithPayload(r.Context(), app.CreateCardPayload{
			CategoryID: categoryID,
			Type:       typ,
			Content:    content,
			Note:       note,
			BatchID:    batchID,
		}, middleware.Username(r.Context()), middleware.ClientIP(r))
		if err2 != nil {
			response.Fail(w, err2)
			return
		}
		response.OK(w, card)
		return
	}
	defer file.Close()
	if hdr.Size > domain.MaxCardContentBytes {
		response.Fail(w, apperr.Validation("文件不能超过 5MB"))
		return
	}
	data, err := io.ReadAll(io.LimitReader(file, domain.MaxCardContentBytes+1))
	if err != nil {
		response.Fail(w, apperr.Validation("读取文件失败"))
		return
	}
	if len(data) > domain.MaxCardContentBytes {
		response.Fail(w, apperr.Validation("文件不能超过 5MB"))
		return
	}
	mime := hdr.Header.Get("Content-Type")
	if mime == "" {
		mime = http.DetectContentType(data)
	}
	if typ == "" {
		typ = domain.TypeFile
	}
	b64 := base64.StdEncoding.EncodeToString(data)
	card, err := h.App.CreateCardWithPayload(r.Context(), app.CreateCardPayload{
		CategoryID:      categoryID,
		Type:            typ,
		Content:         b64,
		ContentEncoding: "base64",
		Filename:        hdr.Filename,
		Mime:            mime,
		Note:            note,
		BatchID:         batchID,
	}, middleware.Username(r.Context()), middleware.ClientIP(r))
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

// ExportCards 导出卡密编码（一行一个）。
// GET：按 query 筛选；POST：可带 ids 导出已选。
// format=txt 或 Accept: text/plain 时流式写出纯文本（省内存）。
func (h *Handler) ExportCards(w http.ResponseWriter, r *http.Request) {
	var ids []string
	status, q, category, batchID := "", "", "", ""
	streamTxt := false
	if r.Method == http.MethodPost {
		var in struct {
			IDs      []string `json:"ids"`
			Status   string   `json:"status"`
			Q        string   `json:"q"`
			Category string   `json:"category"`
			BatchID  string   `json:"batchId"`
			Format   string   `json:"format"`
		}
		if err := h.decode(r, &in); err != nil {
			response.Fail(w, err)
			return
		}
		ids = in.IDs
		status, q, category, batchID = in.Status, in.Q, in.Category, in.BatchID
		streamTxt = strings.EqualFold(in.Format, "txt") || strings.EqualFold(in.Format, "text")
	} else {
		qq := r.URL.Query()
		status = qq.Get("status")
		q = qq.Get("q")
		category = qq.Get("category")
		batchID = qq.Get("batch_id")
		if raw := strings.TrimSpace(qq.Get("ids")); raw != "" {
			ids = strings.Split(raw, ",")
		}
		streamTxt = qq.Get("format") == "txt" || qq.Get("format") == "text"
	}
	if !streamTxt {
		accept := r.Header.Get("Accept")
		streamTxt = strings.Contains(accept, "text/plain")
	}

	actor := middleware.Username(r.Context())
	ip := middleware.ClientIP(r)

	if streamTxt {
		n, err := h.App.StreamExportCardCodes(
			r.Context(), w, status, q, category, batchID, ids, actor, ip,
			func(total int) error {
				w.Header().Set("Content-Type", "text/plain; charset=utf-8")
				w.Header().Set("Content-Disposition", `attachment; filename="cards-export.txt"`)
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("X-Export-Total", strconv.Itoa(total))
				w.WriteHeader(http.StatusOK)
				return nil
			},
			nil,
		)
		if err != nil {
			// 若尚未写头则 JSON 错误；已写头则追加注释
			if w.Header().Get("Content-Type") == "" {
				response.Fail(w, err)
				return
			}
			_, _ = w.Write([]byte("\n# export error: " + err.Error() + "\n"))
			return
		}
		_ = n
		return
	}

	codes, err := h.App.ExportCardCodes(r.Context(), status, q, category, batchID, ids, actor, ip)
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, map[string]any{
		"codes": codes,
		"total": len(codes),
	})
}

func (h *Handler) ListBatches(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	ps, _ := strconv.Atoi(q.Get("page_size"))
	// 兼容旧客户端：无 page 参数时返回第一页较大窗口
	if page < 1 && q.Get("page") == "" && q.Get("page_size") == "" {
		page, ps = 1, 100
	}
	res, err := h.App.ListBatches(r.Context(), q.Get("category"), page, ps)
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, res)
}

func (h *Handler) ExportBatch(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	codes, name, err := h.App.ExportBatchCardCodes(r.Context(), id,
		middleware.Username(r.Context()), middleware.ClientIP(r))
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, map[string]any{
		"codes":     codes,
		"total":     len(codes),
		"batchId":   id,
		"batchName": name,
	})
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
	wantExact := q.Get("exact_total") == "1" || q.Get("exact") == "1"
	res, err := h.App.ListRedeems(r.Context(), page, ps, q.Get("q"), q.Get("category"), q.Get("cursor"), wantExact)
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

// TestMail POST { "to"?: "a@b.com" }  — 空 to 仅测连通
func (h *Handler) TestMail(w http.ResponseWriter, r *http.Request) {
	var in struct {
		To string `json:"to"`
	}
	_ = h.decode(r, &in)
	if err := h.App.TestSMTP(r.Context(), in.To, middleware.Username(r.Context()), middleware.ClientIP(r)); err != nil {
		response.Fail(w, err)
		return
	}
	msg := "SMTP 连通正常"
	if strings.TrimSpace(in.To) != "" {
		msg = "测试邮件已发送"
	}
	response.OK(w, map[string]string{"message": msg})
}

func (h *Handler) ListAudit(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	ps, _ := strconv.Atoi(q.Get("page_size"))
	res, err := h.App.ListAudit(r.Context(), page, ps, q.Get("cursor"))
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, res)
}

func (h *Handler) UploadImage(w http.ResponseWriter, r *http.Request) {
	url, err := h.App.UploadImage(r.Context(), r, middleware.Username(r.Context()), middleware.ClientIP(r))
	if err != nil {
		response.Fail(w, err)
		return
	}
	response.OK(w, map[string]string{"url": url})
}

// silence unused in some builds
var _ = strings.TrimSpace
