package crypto

import (
	"strings"
	"testing"
)

func TestPasswordHash(t *testing.T) {
	h, err := HashPassword("admin123")
	if err != nil {
		t.Fatal(err)
	}
	if !CheckPassword(h, "admin123") {
		t.Fatal("password should match")
	}
	if CheckPassword(h, "wrong") {
		t.Fatal("wrong password should fail")
	}
}

func TestEncryptDecrypt(t *testing.T) {
	key, err := NewAESKeyFromHex("")
	if err != nil {
		t.Fatal(err)
	}
	ct, nonce, err := Encrypt(key, []byte("hello-card"))
	if err != nil {
		t.Fatal(err)
	}
	pt, err := Decrypt(key, ct, nonce)
	if err != nil {
		t.Fatal(err)
	}
	if string(pt) != "hello-card" {
		t.Fatalf("got %q", pt)
	}
}

func TestGenerateCode(t *testing.T) {
	code, err := GenerateCode("VIP")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(code, "VIP-") {
		t.Fatalf("prefix: %s", code)
	}
	parts := strings.Split(code, "-")
	if len(parts) != 5 {
		t.Fatalf("segments: %v", parts)
	}
}

func TestNormalizeCode(t *testing.T) {
	if NormalizeCode("  vip-abc  ") != "VIP-ABC" {
		t.Fatal(NormalizeCode("  vip-abc  "))
	}
}

func TestAPIKeyHash(t *testing.T) {
	a := HashAPIKey("ck_test")
	b := HashAPIKey("ck_test")
	if len(a) != 32 || string(a) != string(b) {
		t.Fatal("hash mismatch")
	}
}
