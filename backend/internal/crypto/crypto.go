package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

func HashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(b), err
}

func CheckPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

func HashAPIKey(plaintext string) []byte {
	sum := sha256.Sum256([]byte(plaintext))
	return sum[:]
}

func NewAESKeyFromHex(hexKey string) ([]byte, error) {
	if hexKey == "" {
		// 禁止静默随机：重启后历史卡密密文将全部无法解密
		return nil, fmt.Errorf("CONTENT_KEY is required (64 hex chars); generate with: openssl rand -hex 32")
	}
	b, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, err
	}
	if len(b) != 32 {
		return nil, fmt.Errorf("CONTENT_KEY must be 32 bytes hex")
	}
	return b, nil
}

func Encrypt(key, plaintext []byte) (ciphertext, nonce []byte, err error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}
	nonce = make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, err
	}
	ciphertext = gcm.Seal(nil, nonce, plaintext, nil)
	return ciphertext, nonce, nil
}

func Decrypt(key, ciphertext, nonce []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, nonce, ciphertext, nil)
}

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func GenerateCode(prefix string) (string, error) {
	prefix = strings.ToUpper(strings.TrimSpace(prefix))
	segs := make([]string, 4)
	buf := make([]byte, 4)
	for i := 0; i < 4; i++ {
		if _, err := rand.Read(buf); err != nil {
			return "", err
		}
		var sb strings.Builder
		for j := 0; j < 4; j++ {
			sb.WriteByte(codeAlphabet[int(buf[j])%len(codeAlphabet)])
		}
		segs[i] = sb.String()
	}
	return prefix + "-" + strings.Join(segs, "-"), nil
}

func NormalizeCode(code string) string {
	return strings.ToUpper(strings.TrimSpace(code))
}

func RandomAPIKey() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "ck_" + hex.EncodeToString(b), nil
}

func RandomPassword(n int) (string, error) {
	const chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = chars[int(b[i])%len(chars)]
	}
	return string(b), nil
}
