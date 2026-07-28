package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
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

// HashAPIKey 兼容旧版：纯 SHA-256（无 pepper）。
// 新写入请使用 HashAPIKeyPeppered。
func HashAPIKey(plaintext string) []byte {
	sum := sha256.Sum256([]byte(plaintext))
	return sum[:]
}

// HashAPIKeyPeppered HMAC-SHA256(pepper, key)，防 DB 泄露后对弱自定义密钥离线爆破。
func HashAPIKeyPeppered(plaintext string, pepper []byte) []byte {
	if len(pepper) == 0 {
		return HashAPIKey(plaintext)
	}
	m := hmac.New(sha256.New, pepper)
	_, _ = m.Write([]byte(plaintext))
	return m.Sum(nil)
}

// APIKeyHashCandidates 查询时同时匹配 peppered 与 legacy，便于平滑迁移。
func APIKeyHashCandidates(plaintext string, pepper []byte) (peppered, legacy []byte) {
	legacy = HashAPIKey(plaintext)
	peppered = HashAPIKeyPeppered(plaintext, pepper)
	return peppered, legacy
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

// randomAlphabetChar 拒绝采样，消除 byte%len 偏差
func randomAlphabetChar(alphabet string) (byte, error) {
	n := len(alphabet)
	if n == 0 || n > 256 {
		return 0, fmt.Errorf("invalid alphabet")
	}
	// 最大可整除 256 的倍数
	max := 256 - (256 % n)
	var b [1]byte
	for {
		if _, err := rand.Read(b[:]); err != nil {
			return 0, err
		}
		v := int(b[0])
		if v < max {
			return alphabet[v%n], nil
		}
	}
}

func GenerateCode(prefix string) (string, error) {
	prefix = strings.ToUpper(strings.TrimSpace(prefix))
	segs := make([]string, 4)
	for i := 0; i < 4; i++ {
		var sb strings.Builder
		for j := 0; j < 4; j++ {
			ch, err := randomAlphabetChar(codeAlphabet)
			if err != nil {
				return "", err
			}
			sb.WriteByte(ch)
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
	out := make([]byte, n)
	for i := 0; i < n; i++ {
		ch, err := randomAlphabetChar(chars)
		if err != nil {
			return "", err
		}
		out[i] = ch
	}
	return string(out), nil
}
