package domain

import "time"

type CardStatus string

const (
	StatusUnused   CardStatus = "unused"
	StatusUsed     CardStatus = "used"
	StatusDisabled CardStatus = "disabled"
	StatusExpired  CardStatus = "expired"
)

type CardType string

const (
	TypeText    CardType = "text"
	TypeTXT     CardType = "txt"
	TypeJSON    CardType = "json"
	TypeAccount CardType = "account"
	TypeImage   CardType = "image"
	TypeZip     CardType = "zip"
	TypePDF     CardType = "pdf"
	TypeFile    CardType = "file" // 任意二进制
)

// IsBinaryCardType 内容按原始字节存储/下载（非纯展示文本）
func IsBinaryCardType(t CardType) bool {
	switch t {
	case TypeImage, TypeZip, TypePDF, TypeFile:
		return true
	default:
		return false
	}
}

// IsTextCardType 可按 UTF-8 文本导入/展示
func IsTextCardType(t CardType) bool {
	return !IsBinaryCardType(t)
}

// MaxCardContentBytes 单卡密内容上限（加密前）
const MaxCardContentBytes = 5 << 20 // 5 MiB

type CategoryIcon struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

type AdminUser struct {
	ID                 string `json:"id"`
	Username           string `json:"username"`
	MustChangePassword bool   `json:"mustChangePassword"`
}

type Category struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Slug        string       `json:"slug"`
	CodePrefix  string       `json:"codePrefix"`
	Description string       `json:"description"`
	Enabled     bool         `json:"enabled"`
	SortOrder   int          `json:"sortOrder"`
	Icon        CategoryIcon `json:"icon"`
	CardCount   *int         `json:"cardCount,omitempty"`
	UnusedCount *int         `json:"unusedCount,omitempty"`
	UsedCount   *int         `json:"usedCount,omitempty"`
	CreatedAt   string       `json:"createdAt"`
}

type PublicCategory struct {
	Slug        string       `json:"slug"`
	Name        string       `json:"name"`
	CodePrefix  string       `json:"codePrefix"`
	Description string       `json:"description"`
	Icon        CategoryIcon `json:"icon"`
}

type Card struct {
	ID           string     `json:"id"`
	CategoryID   string     `json:"categoryId"`
	CategorySlug string     `json:"categorySlug,omitempty"`
	CategoryName string     `json:"categoryName,omitempty"`
	Code         string     `json:"code"`
	Type         CardType   `json:"type"`
	// Content 仅在 reveal 时返回：文本为 UTF-8；二进制为 base64（见 ContentEncoding）
	Content         *string `json:"content,omitempty"`
	ContentEncoding string  `json:"contentEncoding,omitempty"` // utf8 | base64
	Filename        string  `json:"filename,omitempty"`
	Mime            string  `json:"mime,omitempty"`
	Size            int64   `json:"size,omitempty"`
	Status          CardStatus `json:"status"`
	BatchID         *string    `json:"batchId"`
	BatchName       *string    `json:"batchName,omitempty"`
	Note            string     `json:"note"`
	ExpiresAt       *string    `json:"expiresAt"`
	UsedAt          *string    `json:"usedAt"`
	UsedIP          *string    `json:"usedIp"`
	CreatedAt       string     `json:"createdAt"`
}

type Batch struct {
	ID           string `json:"id"`
	CategoryID   string `json:"categoryId"`
	CategoryName string `json:"categoryName,omitempty"`
	Name         string `json:"name"`
	Note         string `json:"note"`
	CardCount    int    `json:"cardCount"`
	UnusedCount  int    `json:"unusedCount"`
	CreatedAt    string `json:"createdAt"`
}

type RedeemRecord struct {
	ID           string `json:"id"`
	CategoryID   string `json:"categoryId"`
	CategorySlug string `json:"categorySlug,omitempty"`
	CategoryName string `json:"categoryName,omitempty"`
	CardID       string `json:"cardId"`
	Code         string `json:"code"`
	IP           string `json:"ip"`
	UserAgent    string `json:"userAgent"`
	CreatedAt    string `json:"createdAt"`
}

type RedeemResult struct {
	Status          string   `json:"status"`
	Category        string   `json:"category"`
	CategoryName    string   `json:"categoryName"`
	Code            string   `json:"code"`
	Type            CardType `json:"type"`
	Content         string   `json:"content"`
	ContentEncoding string   `json:"contentEncoding,omitempty"` // utf8 | base64
	Filename        string   `json:"filename,omitempty"`
	Mime            string   `json:"mime,omitempty"`
	Size            int64    `json:"size,omitempty"`
	RedeemedAt      string   `json:"redeemedAt"`
}

type ApiKeyMeta struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	KeyPrefix        string   `json:"keyPrefix"`
	Scopes           []string `json:"scopes"`
	IsSystemRedeemKey bool    `json:"isSystemRedeemKey,omitempty"`
	Secret           *string  `json:"secret,omitempty"`
	RateLimitRpm     *int     `json:"rateLimitRpm"`
	ExpiresAt        *string  `json:"expiresAt"`
	RevokedAt        *string  `json:"revokedAt"`
	LastUsedAt       *string  `json:"lastUsedAt"`
	CreatedAt        string   `json:"createdAt"`
}

type AuditLog struct {
	ID         string `json:"id"`
	ActorType  string `json:"actorType"`
	ActorLabel string `json:"actorLabel"`
	Action     string `json:"action"`
	Resource   string `json:"resource"`
	Detail     string `json:"detail"`
	IP         string `json:"ip"`
	CreatedAt  string `json:"createdAt"`
}

type Settings struct {
	SiteName                    string `json:"siteName"`
	SiteLogo                    string `json:"siteLogo"`
	SiteFavicon                 string `json:"siteFavicon"`
	FooterText                  string `json:"footerText"`
	DocumentTitle               string `json:"documentTitle"`
	RedeemTitle                 string `json:"redeemTitle"`
	RedeemSubtitle              string `json:"redeemSubtitle"`
	RedeemSuccessHint           string `json:"redeemSuccessHint"`
	RedeemPlaceholder           string `json:"redeemPlaceholder"`
	RedeemButtonText            string `json:"redeemButtonText"`
	RedeemTabVisibleCount       int    `json:"redeemTabVisibleCount"`
	CaptchaEnabled              bool   `json:"captchaEnabled"`
	AllowRequery                bool   `json:"allowRequery"`
	RateLimitIpPerMin           int    `json:"rateLimitIpPerMin"`
	RateLimitCodePerMin         int    `json:"rateLimitCodePerMin"`
	RateLimitFailClosed         bool   `json:"rateLimitFailClosed"`
	MaskCardErrors              bool   `json:"maskCardErrors"`
	ApiDocsEnabled              bool   `json:"apiDocsEnabled"`
	ShowApiDocsEntry            bool   `json:"showApiDocsEntry"`
	ExposePublicRedeemKeyInDocs bool   `json:"exposePublicRedeemKeyInDocs"`
	PublicRedeemApiKey          string `json:"publicRedeemApiKey"`
	ApiBasePath                 string `json:"apiBasePath"`
	// 对外 API 根地址，如 https://api.example.com ；空则文档用当前站点 origin
	ApiPublicBaseUrl string `json:"apiPublicBaseUrl"`

	// —— 邮件（SMTP，对齐 sub2api 配置形态）——
	// SmtpPassword 仅写入；读取时始终清空，用 SmtpPasswordSet 表示是否已配置
	SmtpHost           string `json:"smtpHost"`
	SmtpPort           int    `json:"smtpPort"`
	SmtpUsername       string `json:"smtpUsername"`
	SmtpPassword       string `json:"smtpPassword"`
	SmtpPasswordSet    bool   `json:"smtpPasswordSet"` // 只读投影
	SmtpFromEmail      string `json:"smtpFromEmail"`
	SmtpFromName       string `json:"smtpFromName"`
	SmtpUseTLS         bool   `json:"smtpUseTLS"`
	SmtpSkipTLSVerify  bool   `json:"smtpSkipTlsVerify"`
	// 收件人，多个用逗号/分号/空白分隔
	MailNotifyTo string `json:"mailNotifyTo"`
	// 两类提醒独立开关
	MailHealthAlertEnabled bool `json:"mailHealthAlertEnabled"`
	MailCardAlertEnabled   bool `json:"mailCardAlertEnabled"`
	// 健康：近窗 5xx 比例超过该百分比（0-100）触发；0=仅检测 DB/Redis 连通
	MailHealthErrorRatePct float64 `json:"mailHealthErrorRatePct"`
	// 卡密：任一类别未使用库存 ≤ 阈值触发；0 表示仅在库存为 0 时
	MailCardUnusedThreshold int `json:"mailCardUnusedThreshold"`
	// 同类预警冷却（分钟），防刷信
	MailAlertCooldownMinutes int `json:"mailAlertCooldownMinutes"`
}

type PublicConfig struct {
	SiteName              string           `json:"siteName"`
	SiteLogo              *string          `json:"siteLogo"`
	SiteFavicon           *string          `json:"siteFavicon"`
	FooterText            string           `json:"footerText"`
	// DocumentTitle 浏览器标签标题；空则前端回退 siteName
	DocumentTitle         string           `json:"documentTitle"`
	RedeemTitle           string           `json:"redeemTitle"`
	RedeemSubtitle        string           `json:"redeemSubtitle"`
	RedeemSuccessHint     string           `json:"redeemSuccessHint"`
	RedeemPlaceholder     string           `json:"redeemPlaceholder"`
	RedeemButtonText      string           `json:"redeemButtonText"`
	CaptchaEnabled        bool             `json:"captchaEnabled"`
	RedeemTabVisibleCount int              `json:"redeemTabVisibleCount"`
	ApiBasePath           string           `json:"apiBasePath"`
	ApiPublicBaseUrl      string           `json:"apiPublicBaseUrl"`
	ApiDocsEnabled        bool             `json:"apiDocsEnabled"`
	ShowApiDocsEntry      bool             `json:"showApiDocsEntry"`
	PublicRedeemApiKey    *string          `json:"publicRedeemApiKey"`
	RateLimitIpPerMin     int              `json:"rateLimitIpPerMin"`
	RateLimitCodePerMin   int              `json:"rateLimitCodePerMin"`
	Categories            []PublicCategory `json:"categories"`
}

type PageResult[T any] struct {
	Items    []T `json:"items"`
	Total    int `json:"total"`
	Page     int `json:"page"`
	PageSize int `json:"pageSize"`
}

type DashboardStats struct {
	TotalCards         int `json:"totalCards"`
	UnusedCards        int `json:"unusedCards"`
	UsedCards          int `json:"usedCards"`
	DisabledCards      int `json:"disabledCards"`
	ExpiredCards       int `json:"expiredCards"`
	TodayRedeems       int `json:"todayRedeems"`
	YesterdayRedeems   int `json:"yesterdayRedeems"`
	WeekRedeems        int `json:"weekRedeems"`
	TotalRedeems       int `json:"totalRedeems"`
	RedeemRate         int `json:"redeemRate"`
	TotalCategories    int `json:"totalCategories"`
	EnabledCategories  int `json:"enabledCategories"`
	ActiveApiKeys      int `json:"activeApiKeys"`
	Trend              []struct {
		Date  string `json:"date"`
		Count int    `json:"count"`
	} `json:"trend"`
	ByCategory []struct {
		Slug       string       `json:"slug"`
		Name       string       `json:"name"`
		Icon       CategoryIcon `json:"icon"`
		Unused     int          `json:"unused"`
		Used       int          `json:"used"`
		Total      int          `json:"total"`
		RedeemRate int          `json:"redeemRate"`
	} `json:"byCategory"`
	RecentRedeems   []RedeemRecord `json:"recentRedeems"`
	StatusBreakdown []struct {
		Status CardStatus `json:"status"`
		Count  int        `json:"count"`
	} `json:"statusBreakdown"`
}

func FormatTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339Nano)
}

func PtrTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := FormatTime(*t)
	return &s
}
