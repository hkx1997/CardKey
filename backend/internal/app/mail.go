package app

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"time"

	"github.com/cardkey/cardkey/internal/domain"
	"github.com/cardkey/cardkey/internal/pkg/apperr"
)

// isValidEmailAddr 校验可作 RCPT 的邮箱（拒绝「您好」等中文昵称）
func isValidEmailAddr(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" || !strings.Contains(s, "@") {
		return false
	}
	// 不允许空白/中文等非地址字符混在裸地址里
	for _, r := range s {
		if r > 127 || r == ' ' || r == '<' || r == '>' {
			// 允许 "Name <a@b.com>" 形式，走 mail.ParseAddress
			break
		}
	}
	addr, err := mail.ParseAddress(s)
	if err != nil {
		return false
	}
	a := strings.TrimSpace(addr.Address)
	if a == "" || !strings.Contains(a, "@") {
		return false
	}
	parts := strings.Split(a, "@")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" || !strings.Contains(parts[1], ".") {
		return false
	}
	return true
}

func normalizeEmailAddr(s string) (string, error) {
	s = strings.TrimSpace(s)
	if !isValidEmailAddr(s) {
		return "", apperr.Validation("收件人邮箱格式无效（请填写如 name@qq.com，不要填昵称）")
	}
	addr, err := mail.ParseAddress(s)
	if err != nil {
		return "", apperr.Validation("收件人邮箱格式无效")
	}
	return strings.TrimSpace(addr.Address), nil
}

// parseMailRecipients 支持逗号/分号/换行分隔；仅保留合法邮箱
func parseMailRecipients(s string) []string {
	s = strings.ReplaceAll(s, ";", ",")
	s = strings.ReplaceAll(s, "\n", ",")
	parts := strings.Split(s, ",")
	var out []string
	seen := map[string]bool{}
	for _, p := range parts {
		e, err := normalizeEmailAddr(p)
		if err != nil {
			continue
		}
		low := strings.ToLower(e)
		if seen[low] {
			continue
		}
		seen[low] = true
		out = append(out, e)
	}
	return out
}

func encodeRFC2047(s string) string {
	need := false
	for _, r := range s {
		if r > 127 {
			need = true
			break
		}
	}
	if !need {
		return s
	}
	return "=?UTF-8?B?" + base64.StdEncoding.EncodeToString([]byte(s)) + "?="
}

type smtpRuntime struct {
	Host       string
	Port       int
	Username   string
	Password   string
	From       string
	FromName   string
	UseTLS     bool
	SkipVerify bool
}

func (a *App) loadSMTPRuntime(ctx context.Context) (smtpRuntime, error) {
	raw, err := a.loadSettingsRaw(ctx)
	if err != nil {
		return smtpRuntime{}, err
	}
	host := strings.TrimSpace(raw.SmtpHost)
	port := raw.SmtpPort
	if port <= 0 {
		port = 587
	}
	from := strings.TrimSpace(raw.SmtpFromEmail)
	user := strings.TrimSpace(raw.SmtpUsername)
	if from == "" {
		from = user
	}
	if host == "" || from == "" {
		return smtpRuntime{}, apperr.Validation("请先配置 SMTP 主机与发件人邮箱")
	}
	name := strings.TrimSpace(raw.SmtpFromName)
	if name == "" {
		name = "CardKey"
	}
	return smtpRuntime{
		Host: host, Port: port, Username: user, Password: raw.SmtpPassword,
		From: from, FromName: name, UseTLS: raw.SmtpUseTLS, SkipVerify: raw.SmtpSkipTLSVerify,
	}, nil
}

// SendMail 发送 UTF-8 纯文本邮件
func (a *App) SendMail(ctx context.Context, to []string, subject, plainBody string) error {
	if len(to) == 0 {
		return apperr.Validation("收件人为空")
	}
	// 规范化并过滤非法地址，避免 SMTP 501 Bad address syntax
	clean := make([]string, 0, len(to))
	for _, raw := range to {
		e, err := normalizeEmailAddr(raw)
		if err != nil {
			return apperr.Validation("收件人「" + strings.TrimSpace(raw) + "」不是有效邮箱，请填写如 name@qq.com")
		}
		clean = append(clean, e)
	}
	to = clean
	cfg, err := a.loadSMTPRuntime(ctx)
	if err != nil {
		return err
	}
	fromHeader := cfg.From
	if cfg.FromName != "" {
		fromHeader = fmt.Sprintf("%s <%s>", encodeRFC2047(cfg.FromName), cfg.From)
	}
	msg := strings.Join([]string{
		"From: " + fromHeader,
		"To: " + strings.Join(to, ", "),
		"Subject: " + encodeRFC2047(subject),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
		"",
		plainBody,
	}, "\r\n")
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	if cfg.Port == 465 {
		return smtpSendImplicitTLS(ctx, addr, cfg, to, []byte(msg))
	}
	return smtpSendPlainOrStartTLS(ctx, addr, cfg, to, []byte(msg))
}

func smtpDialTimeout(ctx context.Context, network, addr string) (net.Conn, error) {
	d := net.Dialer{Timeout: 15 * time.Second}
	return d.DialContext(ctx, network, addr)
}

func smtpSendImplicitTLS(ctx context.Context, addr string, cfg smtpRuntime, to []string, msg []byte) error {
	tlsCfg := &tls.Config{ServerName: cfg.Host, MinVersion: tls.VersionTLS12, InsecureSkipVerify: cfg.SkipVerify}
	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 15 * time.Second}, "tcp", addr, tlsCfg)
	if err != nil {
		return apperr.Internal("SMTP TLS 连接失败: " + err.Error())
	}
	defer conn.Close()
	c, err := smtp.NewClient(conn, cfg.Host)
	if err != nil {
		return apperr.Internal("SMTP 客户端失败: " + err.Error())
	}
	defer c.Close()
	return smtpClientSend(c, cfg, to, msg)
}

func smtpSendPlainOrStartTLS(ctx context.Context, addr string, cfg smtpRuntime, to []string, msg []byte) error {
	conn, err := smtpDialTimeout(ctx, "tcp", addr)
	if err != nil {
		return apperr.Internal("SMTP 连接失败: " + err.Error())
	}
	c, err := smtp.NewClient(conn, cfg.Host)
	if err != nil {
		_ = conn.Close()
		return apperr.Internal("SMTP 客户端失败: " + err.Error())
	}
	defer c.Close()
	if cfg.UseTLS {
		tlsCfg := &tls.Config{ServerName: cfg.Host, MinVersion: tls.VersionTLS12, InsecureSkipVerify: cfg.SkipVerify}
		if ok, _ := c.Extension("STARTTLS"); ok {
			if err := c.StartTLS(tlsCfg); err != nil {
				return apperr.Internal("SMTP STARTTLS 失败: " + err.Error())
			}
		}
	}
	return smtpClientSend(c, cfg, to, msg)
}

func smtpClientSend(c *smtp.Client, cfg smtpRuntime, to []string, msg []byte) error {
	if cfg.Username != "" {
		auth := smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
		if ok, _ := c.Extension("AUTH"); ok {
			if err := c.Auth(auth); err != nil {
				return apperr.Validation("SMTP 认证失败: " + err.Error())
			}
		}
	}
	if err := c.Mail(cfg.From); err != nil {
		return apperr.Internal("SMTP MAIL FROM 失败: " + err.Error())
	}
	for _, rcpt := range to {
		if err := c.Rcpt(rcpt); err != nil {
			return apperr.Validation("SMTP RCPT 失败 (" + rcpt + "): " + err.Error())
		}
	}
	w, err := c.Data()
	if err != nil {
		return apperr.Internal("SMTP DATA 失败: " + err.Error())
	}
	if _, err := w.Write(msg); err != nil {
		_ = w.Close()
		return apperr.Internal("SMTP 写入失败: " + err.Error())
	}
	if err := w.Close(); err != nil {
		return apperr.Internal("SMTP 结束失败: " + err.Error())
	}
	_ = c.Quit()
	return nil
}

// TestSMTP 测试连接并可选发信
func (a *App) TestSMTP(ctx context.Context, toEmail string, actor, ip string) error {
	toEmail = strings.TrimSpace(toEmail)
	if toEmail == "" {
		// 无收件人：仅校验配置可加载 + 握手
		cfg, err := a.loadSMTPRuntime(ctx)
		if err != nil {
			return err
		}
		addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
		if cfg.Port == 465 {
			tlsCfg := &tls.Config{ServerName: cfg.Host, MinVersion: tls.VersionTLS12, InsecureSkipVerify: cfg.SkipVerify}
			conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 12 * time.Second}, "tcp", addr, tlsCfg)
			if err != nil {
				return apperr.Validation("连接失败: " + err.Error())
			}
			_ = conn.Close()
		} else {
			conn, err := smtpDialTimeout(ctx, "tcp", addr)
			if err != nil {
				return apperr.Validation("连接失败: " + err.Error())
			}
			_ = conn.Close()
		}
		a.Audit(ctx, "admin", actor, "mail_test_connect", "settings", "SMTP 连通测试", ip)
		return nil
	}
	// 先校验格式，避免 QQ 等返回 501 Bad address syntax
	norm, err := normalizeEmailAddr(toEmail)
	if err != nil {
		return err
	}
	toEmail = norm
	site := "CardKey"
	if s, err := a.GetSettings(ctx); err == nil && s.SiteName != "" {
		site = s.SiteName
	}
	body := fmt.Sprintf("这是一封来自 %s 的测试邮件。\n\n时间：%s\n若收到此信，说明 SMTP 配置正确。\n",
		site, time.Now().Format(time.RFC3339))
	if err := a.SendMail(ctx, []string{toEmail}, "["+site+"] 邮件测试", body); err != nil {
		return err
	}
	a.Audit(ctx, "admin", actor, "mail_test_send", "settings", "测试邮件 → "+toEmail, ip)
	return nil
}

// mailCooldownOK 返回 true 表示冷却已过、可以发
func (a *App) mailCooldownOK(ctx context.Context, key string, minutes int) bool {
	if minutes < 1 {
		minutes = 60
	}
	if a.RDB == nil {
		return true
	}
	k := "mail:alert:cd:" + key
	ok, err := a.RDB.SetNX(ctx, k, "1", time.Duration(minutes)*time.Minute).Result()
	if err != nil {
		return true
	}
	return ok
}

// EvaluateMailAlerts 周期任务：健康 / 卡密预警
func (a *App) EvaluateMailAlerts(ctx context.Context) {
	s, err := a.loadSettingsRaw(ctx)
	if err != nil {
		return
	}
	if strings.TrimSpace(s.SmtpHost) == "" || strings.TrimSpace(s.SmtpFromEmail) == "" && strings.TrimSpace(s.SmtpUsername) == "" {
		return
	}
	to := parseMailRecipients(s.MailNotifyTo)
	if len(to) == 0 {
		return
	}
	site := s.SiteName
	if site == "" {
		site = "CardKey"
	}
	cooldown := s.MailAlertCooldownMinutes
	if cooldown < 5 {
		cooldown = 60
	}

	if s.MailHealthAlertEnabled {
		if issues := a.collectHealthIssues(ctx, s); len(issues) > 0 {
			if a.mailCooldownOK(ctx, "health", cooldown) {
				body := "【平台健康预警】" + site + "\n\n检测到以下问题：\n- " +
					strings.Join(issues, "\n- ") +
					"\n\n请尽快检查服务状态（Postgres / Redis / 错误率等）。\n时间：" +
					time.Now().Format(time.RFC3339) + "\n"
				if err := a.SendMail(ctx, to, "["+site+"] 平台健康预警", body); err != nil {
					if a.Log != nil {
						a.Log.Warn("mail health alert failed", "err", err)
					}
				} else if a.Log != nil {
					a.Log.Info("mail health alert sent", "to", to)
				}
			}
		}
	}

	if s.MailCardAlertEnabled {
		if lines, ok := a.collectCardStockIssues(ctx, s); ok {
			if a.mailCooldownOK(ctx, "card", cooldown) {
				body := "【卡密库存预警】" + site + "\n\n以下类别库存偏低或已耗尽：\n- " +
					strings.Join(lines, "\n- ") +
					"\n\n阈值：未使用 ≤ " + fmt.Sprintf("%d", s.MailCardUnusedThreshold) +
					"\n时间：" + time.Now().Format(time.RFC3339) + "\n"
				if err := a.SendMail(ctx, to, "["+site+"] 卡密库存预警", body); err != nil {
					if a.Log != nil {
						a.Log.Warn("mail card alert failed", "err", err)
					}
				} else if a.Log != nil {
					a.Log.Info("mail card alert sent", "to", to)
				}
			}
		}
	}
}

func (a *App) collectHealthIssues(ctx context.Context, s domain.Settings) []string {
	var issues []string
	if a.Pool != nil {
		if err := a.Pool.Ping(ctx); err != nil {
			issues = append(issues, "PostgreSQL 不可用: "+err.Error())
		}
	} else {
		issues = append(issues, "PostgreSQL 连接池未初始化")
	}
	if a.RDB != nil {
		if err := a.RDB.Ping(ctx).Err(); err != nil {
			issues = append(issues, "Redis 不可用: "+err.Error())
		}
	} else {
		// Redis 可选；若生产强制则已在启动失败
	}
	// 5xx 比例
	thr := s.MailHealthErrorRatePct
	if thr > 0 {
		total := httpTotal.Load()
		e5 := httpErrors5xx.Load()
		if total >= 50 { // 样本足够再告警
			pct := float64(e5) * 100 / float64(total)
			if pct >= thr {
				issues = append(issues, fmt.Sprintf("HTTP 5xx 比例 %.1f%%（阈值 %.1f%%，样本 %d）", pct, thr, total))
			}
		}
	}
	return issues
}

func (a *App) collectCardStockIssues(ctx context.Context, s domain.Settings) ([]string, bool) {
	thr := s.MailCardUnusedThreshold
	rows, err := a.Pool.Query(ctx, `
		SELECT c.name, c.slug, COUNT(cards.id) FILTER (WHERE cards.status='unused') AS unused
		FROM categories c
		LEFT JOIN cards ON cards.category_id = c.id
		WHERE c.enabled = true
		GROUP BY c.id
		ORDER BY unused ASC, c.sort_order`)
	if err != nil {
		return nil, false
	}
	defer rows.Close()
	var lines []string
	for rows.Next() {
		var name, slug string
		var unused int
		if err := rows.Scan(&name, &slug, &unused); err != nil {
			continue
		}
		if unused <= thr {
			lines = append(lines, fmt.Sprintf("%s (%s)：未使用 %d", name, slug, unused))
		}
	}
	return lines, len(lines) > 0
}
