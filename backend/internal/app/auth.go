package app

import (
	"context"
	"strings"
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

func (a *App) Login(ctx context.Context, username, password, ip string) (domain.AdminUser, string, error) {
	username = strings.TrimSpace(username)
	if username == "" || password == "" {
		return domain.AdminUser{}, "", apperr.Unauthorized("账号或密码错误")
	}
	if a.Limiter != nil {
		okIP, _ := a.Limiter.Allow(ctx, "login:ip:"+ip, 20)
		okUser, _ := a.Limiter.Allow(ctx, "login:user:"+username, 10)
		if !okIP || !okUser {
			return domain.AdminUser{}, "", apperr.RateLimited("登录尝试过多，请稍后再试")
		}
	}
	var id, hash string
	var must bool
	err := a.Pool.QueryRow(ctx, `
		SELECT id, password_hash, must_change_password FROM admins WHERE username=$1`, username).
		Scan(&id, &hash, &must)
	if err != nil {
		_ = crypto.CheckPassword("$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy", password)
		return domain.AdminUser{}, "", apperr.Unauthorized("账号或密码错误")
	}
	if !crypto.CheckPassword(hash, password) {
		return domain.AdminUser{}, "", apperr.Unauthorized("账号或密码错误")
	}
	_, _ = a.Pool.Exec(ctx, `UPDATE admins SET last_login_at=now() WHERE id=$1`, id)
	a.Audit(ctx, "admin", username, "login", "auth", "登录成功", ip)
	token, err := a.issueJWT(id, username)
	if err != nil {
		return domain.AdminUser{}, "", apperr.Internal("签发令牌失败")
	}
	return domain.AdminUser{ID: id, Username: username, MustChangePassword: must}, token, nil
}

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
	if a.RDB == nil || jti == "" {
		return false
	}
	n, err := a.RDB.Exists(ctx, "jwt:bl:"+jti).Result()
	return err == nil && n > 0
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
		SELECT id, username, must_change_password FROM admins WHERE id=$1`, adminID).
		Scan(&u.ID, &u.Username, &u.MustChangePassword)
	if err != nil {
		return u, apperr.Unauthorized("未登录")
	}
	return u, nil
}

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
