package app

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/cardkey/cardkey/internal/domain"
)

func TestSignWebhookBody(t *testing.T) {
	body := []byte(`{"event":"redeem.success","code":"X"}`)
	secret := "test-secret"
	got := SignWebhookBody(secret, body)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	want := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
	if SignWebhookBody("", body) != "" {
		t.Fatal("empty secret should yield empty sig")
	}
}

func TestBuildRedeemWebhookPayloadJSON(t *testing.T) {
	res := domain.RedeemResult{
		Status: "success", Category: "vip", CategoryName: "VIP",
		Code: "VIP-A", Type: domain.TypeText, RedeemedAt: "2026-01-01T00:00:00Z",
	}
	b, err := BuildRedeemWebhookPayloadJSON(res, "1.2.3.4")
	if err != nil {
		t.Fatal(err)
	}
	if len(b) < 20 {
		t.Fatal(string(b))
	}
	// 签名必须覆盖完整 body
	sig := SignWebhookBody("s3cr3t", b)
	if sig == "" || len(sig) < 20 {
		t.Fatal(sig)
	}
}
