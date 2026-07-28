package crypto

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"strings"
	"time"
)

// GenerateTOTPSecret 返回 base32 密钥（无 padding）。
func GenerateTOTPSecret() (string, error) {
	b := make([]byte, 20)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return strings.TrimRight(base32.StdEncoding.EncodeToString(b), "="), nil
}

// TOTPCode 计算 6 位 TOTP（RFC 6238, SHA1, 30s）。
func TOTPCode(secret string, t time.Time) (string, error) {
	key, err := decodeBase32(secret)
	if err != nil {
		return "", err
	}
	counter := uint64(t.Unix() / 30)
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], counter)
	mac := hmac.New(sha1.New, key)
	_, _ = mac.Write(buf[:])
	sum := mac.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	code := (int(sum[off])&0x7f)<<24 |
		(int(sum[off+1])&0xff)<<16 |
		(int(sum[off+2])&0xff)<<8 |
		(int(sum[off+3]) & 0xff)
	code = code % 1000000
	return fmt.Sprintf("%06d", code), nil
}

// ValidateTOTP 校验当前及相邻时间窗（±1）。
func ValidateTOTP(secret, code string, now time.Time) bool {
	code = strings.TrimSpace(code)
	if secret == "" || len(code) != 6 {
		return false
	}
	for _, d := range []time.Duration{0, -30 * time.Second, 30 * time.Second} {
		want, err := TOTPCode(secret, now.Add(d))
		if err == nil && hmac.Equal([]byte(want), []byte(code)) {
			return true
		}
	}
	return false
}

// TOTPProvisioningURI otpauth URL。
func TOTPProvisioningURI(secret, account, issuer string) string {
	secret = strings.TrimRight(secret, "=")
	return fmt.Sprintf(
		"otpauth://totp/%s:%s?secret=%s&issuer=%s&algorithm=SHA1&digits=6&period=30",
		issuer, account, secret, issuer,
	)
}

func decodeBase32(s string) ([]byte, error) {
	s = strings.ToUpper(strings.TrimSpace(s))
	s = strings.TrimRight(s, "=")
	// pad
	if m := len(s) % 8; m != 0 {
		s += strings.Repeat("=", 8-m)
	}
	return base32.StdEncoding.DecodeString(s)
}
