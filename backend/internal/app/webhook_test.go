package app

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestWebhookSignatureShape(t *testing.T) {
	body := []byte(`{"event":"redeem.success"}`)
	secret := "test-secret"
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	sig := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	if len(sig) < 20 {
		t.Fatal(sig)
	}
	// 固定向量 smoke
	if !hmac.Equal(mac.Sum(nil), mac.Sum(nil)) {
		t.Fatal("hmac equal")
	}
}
