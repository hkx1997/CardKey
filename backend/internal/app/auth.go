package app

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/cardkey/cardkey/internal/crypto"
	"github.com/cardkey/cardkey/internal/domain"
	"github.com/cardkey/cardkey/internal/pkg/apperr"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type Claims struct {
	AdminID  string `json:"adminId"`
	Username string `json:"username"`
	jwt.RegisteredClaims
}

// LoginResult 登录结果：要么 JWT，要么需 TOTP。
type LoginResult struct {
	User         domain.AdminUser
	Token        string
	RequiresTOTP bool
	Ticket       string
}

func (a *App) Login(ctx context.Context, username, password, ip string) (domain.AdminUser, string, error) {
	res, err := a.LoginStep(ctx, username, password, ip)
	if err != nil {
		return domain.AdminUser{}, "", err
	}
	if res.RequiresTOTP {
		// 兼容旧调用：用特殊错误码提示前端
		return domain.AdminUser{}, "", apperr.New(401, "TOTP_REQUIRED", "请输入两步验证码")
	}
	return res.User, res.Token, nil
}

// LoginStep 密码校验；若开启 2FA 返回 ticket 而非 JWT。
func (a *App) LoginStep(ctx context.Context, username, password, ip string) (LoginResult, error) {
	username = strings.TrimSpace(username)
	if username == "" || password == "" {
		return LoginResult{}, apperr.Unauthorized("账号或密码错误")
	}
	if a.Limiter != nil {
		okIP, errIP := a.Limiter.Allow(ctx, "login:ip:"+ip, 20)
		okUser, errUser := a.Limiter.Allow(ctx, "login:user:"+username, 10)
		if errIP != nil || errUser != nil {
			if a.Env == "production" || a.RateLimitFailClosed {
				return LoginResult{}, apperr.RateLimited("登录限流暂不可用，请稍后再试")
			}
		} else if !okIP || !okUser {
			return LoginResult{}, apperr.RateLimited("登录尝试过多，请稍后再试")
		}
	}
	var id, hash, totpSecret string
	var must, totpOn bool
	err := a.Pool.QueryRow(ctx, `
		SELECT id, password_hash, must_change_password,
			COALESCE(totp_secret,''), COALESCE(totp_enabled,false)
		FROM admins WHERE username=$1`, username).
		Scan(&id, &hash, &must, &totpSecret, &totpOn)
	if err != nil {
		_ = crypto.CheckPassword("$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy", password)
		return LoginResult{}, apperr.Unauthorized("账号或密码错误")
	}
	if !crypto.CheckPassword(hash, password) {
		return LoginResult{}, apperr.Unauthorized("账号或密码错误")
	}
	user := domain.AdminUser{ID: id, Username: username, MustChangePassword: must, TotpEnabled: totpOn}
	if totpOn && totpSecret != "" {
		ticket, err := a.issueLoginTicket(ctx, id, username)
		if err != nil {
			return LoginResult{}, apperr.Internal("签发登录票据失败")
		}
		return LoginResult{User: user, RequiresTOTP: true, Ticket: ticket}, nil
	}
	_, _ = a.Pool.Exec(ctx, `UPDATE admins SET last_login_at=now() WHERE id=$1`, id)
	a.Audit(ctx, "admin", username, "login", "auth", "登录成功", ip)
	token, err := a.issueJWT(id, username)
	if err != nil {
		return LoginResult{}, apperr.Internal("签发令牌失败")
	}
	return LoginResult{User: user, Token: token}, nil
}

// CompleteLoginTOTP 用 ticket + TOTP 换 JWT。
func (a *App) CompleteLoginTOTP(ctx context.Context, ticket, code, ip string) (domain.AdminUser, string, error) {
	adminID, username, err := a.consumeLoginTicket(ctx, ticket)
	if err != nil {
		return domain.AdminUser{}, "", err
	}
	var secret string
	var must, totpOn bool
	err = a.Pool.QueryRow(ctx, `
		SELECT COALESCE(totp_secret,''), COALESCE(totp_enabled,false), must_change_password
		FROM admins WHERE id=$1`, adminID).Scan(&secret, &totpOn, &must)
	if err != nil || !totpOn || secret == "" {
		return domain.AdminUser{}, "", apperr.Unauthorized("两步验证未启用")
	}
	if !crypto.ValidateTOTP(secret, code, time.Now()) {
		return domain.AdminUser{}, "", apperr.Unauthorized("验证码错误")
	}
	_, _ = a.Pool.Exec(ctx, `UPDATE admins SET last_login_at=now() WHERE id=$1`, adminID)
	a.Audit(ctx, "admin", username, "login_totp", "auth", "两步验证登录成功", ip)
	token, err := a.issueJWT(adminID, username)
	if err != nil {
		return domain.AdminUser{}, "", apperr.Internal("签发令牌失败")
	}
	return domain.AdminUser{ID: adminID, Username: username, MustChangePassword: must, TotpEnabled: true}, token, nil
}

func (a *App) issueLoginTicket(ctx context.Context, adminID, username string) (string, error) {
	ticket := uuid.NewString()
	if a.RDB != nil {
		key := "login:ticket:" + ticket
		val := adminID + "|" + username
		if err := a.RDB.Set(ctx, key, val, 5*time.Minute).Err(); err != nil {
			return "", err
		}
		return ticket, nil
	}
	// 无 Redis：内存 map（单实例测试/开发）
	loginTickets.Store(ticket, loginTicketVal{adminID: adminID, username: username, exp: time.Now().Add(5 * time.Minute)})
	return ticket, nil
}

func (a *App) consumeLoginTicket(ctx context.Context, ticket string) (adminID, username string, err error) {
	ticket = strings.TrimSpace(ticket)
	if ticket == "" {
		return "", "", apperr.Unauthorized("登录票据无效")
	}
	if a.RDB != nil {
		key := "login:ticket:" + ticket
		val, e := a.RDB.Get(ctx, key).Result()
		if e != nil || val == "" {
			return "", "", apperr.Unauthorized("登录票据无效或已过期")
		}
		_ = a.RDB.Del(ctx, key).Err()
		parts := strings.SplitN(val, "|", 2)
		if len(parts) != 2 {
			return "", "", apperr.Unauthorized("登录票据无效")
		}
		return parts[0], parts[1], nil
	}
	v, ok := loginTickets.LoadAndDelete(ticket)
	if !ok {
		return "", "", apperr.Unauthorized("登录票据无效或已过期")
	}
	tv := v.(loginTicketVal)
	if time.Now().After(tv.exp) {
		return "", "", apperr.Unauthorized("登录票据已过期")
	}
	return tv.adminID, tv.username, nil
}

type loginTicketVal struct {
	adminID, username string
	exp               time.Time
}

var loginTickets sync.Map

func (a *App) issueJWT(adminID, username string) (string, error) {
	jti := uuid.NewString()
	claims := Claims{
		AdminID:  adminID,
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Subject:   adminID,
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString(a.JWTSecret)
}

func (a *App) ParseJWT(ctx context.Context, token string) (*Claims, error) {
	parsed, err := jwt.ParseWithClaims(token, &Claims{}, func(t *jwt.Token) (any, error) {
		if t.Method == nil || t.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, apperr.Unauthorized("未登录或会话已过期")
		}
		return a.JWTSecret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil {
		return nil, apperr.Unauthorized("未登录或会话已过期")
	}
	claims, ok := parsed.Claims.(*Claims)
	if !ok || !parsed.Valid {
		return nil, apperr.Unauthorized("未登录或会话已过期")
	}
	if claims.AdminID == "" {
		return nil, apperr.Unauthorized("未登录或会话已过期")
	}
	if claims.ID != "" && a.isJWTBlacklisted(ctx, claims.ID) {
		return nil, apperr.Unauthorized("会话已注销")
	}
	return claims, nil
}

func (a *App) isJWTBlacklisted(ctx context.Context, jti string) bool {
	if jti == "" {
		return false
	}
	// 生产要求 Redis：无 Redis 时拒绝所有 JWT（须重新登录），避免吊销失效窗口
	if a.RDB == nil {
		return a.Env == "production" || a.RequireRedis
	}
	n, err := a.RDB.Exists(ctx, "jwt:bl:"+jti).Result()
	if err != nil {
		// 查询失败：fail-closed，当作已吊销
		return true
	}
	return n > 0
}

// RevokeJWT 将 jti 加入黑名单直至过期。
func (a *App) RevokeJWT(ctx context.Context, token string) {
	if a.RDB == nil || token == "" {
		return
	}
	parsed, err := jwt.ParseWithClaims(token, &Claims{}, func(t *jwt.Token) (any, error) {
		if t.Method == nil || t.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, apperr.Unauthorized("invalid")
		}
		return a.JWTSecret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil {
		return
	}
	claims, ok := parsed.Claims.(*Claims)
	if !ok || claims.ID == "" {
		return
	}
	ttl := 24 * time.Hour
	if claims.ExpiresAt != nil {
		ttl = time.Until(claims.ExpiresAt.Time)
		if ttl <= 0 {
			return
		}
	}
	_ = a.RDB.Set(ctx, "jwt:bl:"+claims.ID, "1", ttl).Err()
}

func (a *App) Me(ctx context.Context, adminID string) (domain.AdminUser, error) {
	var u domain.AdminUser
	err := a.Pool.QueryRow(ctx, `
		SELECT id, username, must_change_password, COALESCE(totp_enabled,false)
		FROM admins WHERE id=$1`, adminID).
		Scan(&u.ID, &u.Username, &u.MustChangePassword, &u.TotpEnabled)
	if err != nil {
		return u, apperr.Unauthorized("未登录")
	}
	return u, nil
}

// BeginTOTPSetup 生成密钥与 otpauth URI（尚未启用，需 Confirm）。
func (a *App) BeginTOTPSetup(ctx context.Context, adminID, username string) (secret, uri string, err error) {
	secret, err = crypto.GenerateTOTPSecret()
	if err != nil {
		return "", "", apperr.Internal("生成密钥失败")
	}
	// 暂存 pending secret（Redis 或内存）
	pendingTOTP.Store(adminID, secret)
	if a.RDB != nil {
		_ = a.RDB.Set(ctx, "totp:pending:"+adminID, secret, 15*time.Minute).Err()
	}
	uri = crypto.TOTPProvisioningURI(secret, username, "CardKey")
	return secret, uri, nil
}

// ConfirmTOTPSetup 用验证码确认并启用 2FA。
func (a *App) ConfirmTOTPSetup(ctx context.Context, adminID, code string) error {
	secret := ""
	if a.RDB != nil {
		secret, _ = a.RDB.Get(ctx, "totp:pending:"+adminID).Result()
	}
	if secret == "" {
		if v, ok := pendingTOTP.Load(adminID); ok {
			secret = v.(string)
		}
	}
	if secret == "" {
		return apperr.Validation("请先开始绑定两步验证")
	}
	if !crypto.ValidateTOTP(secret, code, time.Now()) {
		return apperr.Validation("验证码错误")
	}
	_, err := a.Pool.Exec(ctx, `
		UPDATE admins SET totp_secret=$1, totp_enabled=true, updated_at=now() WHERE id=$2`, secret, adminID)
	if err != nil {
		return err
	}
	pendingTOTP.Delete(adminID)
	if a.RDB != nil {
		_ = a.RDB.Del(ctx, "totp:pending:"+adminID).Err()
	}
	a.Audit(ctx, "admin", adminID, "totp_enable", "auth", "启用两步验证", "")
	return nil
}

// DisableTOTP 关闭 2FA（需当前验证码）。
func (a *App) DisableTOTP(ctx context.Context, adminID, code string) error {
	var secret string
	var on bool
	err := a.Pool.QueryRow(ctx, `
		SELECT COALESCE(totp_secret,''), COALESCE(totp_enabled,false) FROM admins WHERE id=$1`, adminID).
		Scan(&secret, &on)
	if err != nil {
		return apperr.Unauthorized("未登录")
	}
	if !on {
		return nil
	}
	if !crypto.ValidateTOTP(secret, code, time.Now()) {
		return apperr.Validation("验证码错误")
	}
	_, err = a.Pool.Exec(ctx, `
		UPDATE admins SET totp_secret='', totp_enabled=false, updated_at=now() WHERE id=$1`, adminID)
	if err != nil {
		return err
	}
	a.Audit(ctx, "admin", adminID, "totp_disable", "auth", "关闭两步验证", "")
	return nil
}

var pendingTOTP sync.Map

func (a *App) ChangePassword(ctx context.Context, adminID, oldPW, newPW string) error {
	var hash string
	if err := a.Pool.QueryRow(ctx, `SELECT password_hash FROM admins WHERE id=$1`, adminID).Scan(&hash); err != nil {
		return apperr.Unauthorized("未登录")
	}
	if !crypto.CheckPassword(hash, oldPW) {
		return apperr.Validation("原密码不正确")
	}
	if len(newPW) < 8 {
		return apperr.Validation("新密码至少 8 位")
	}
	if oldPW == newPW {
		return apperr.Validation("新密码不能与原密码相同")
	}
	nh, err := crypto.HashPassword(newPW)
	if err != nil {
		return apperr.Internal("密码加密失败")
	}
	_, err = a.Pool.Exec(ctx, `
		UPDATE admins SET password_hash=$1, must_change_password=false, updated_at=now() WHERE id=$2`, nh, adminID)
	return err
}

// MustChangePassword 查询是否需要强制改密。
func (a *App) MustChangePassword(ctx context.Context, adminID string) (bool, error) {
	var must bool
	err := a.Pool.QueryRow(ctx, `SELECT must_change_password FROM admins WHERE id=$1`, adminID).Scan(&must)
	return must, err
}
