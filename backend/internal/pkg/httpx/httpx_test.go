package httpx

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeJSON(t *testing.T) {
	type body struct {
		Name string `json:"name"`
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{"name":"a"}`))
	var b body
	if err := DecodeJSON(req, &b, 1024); err != nil {
		t.Fatal(err)
	}
	if b.Name != "a" {
		t.Fatalf("name=%s", b.Name)
	}
}

func TestDecodeJSONUnknownField(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{"name":"a","x":1}`))
	var b struct {
		Name string `json:"name"`
	}
	if err := DecodeJSON(req, &b, 1024); err == nil {
		t.Fatal("expected error")
	}
}

func TestDecodeJSONTooLarge(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(strings.Repeat("a", 100)))
	var b map[string]any
	if err := DecodeJSON(req, &b, 10); err == nil {
		t.Fatal("expected too large")
	}
}

func TestClientIP(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "1.2.3.4:5678"
	if ClientIP(req, false) != "1.2.3.4" {
		t.Fatal(ClientIP(req, false))
	}
	req.Header.Set("X-Forwarded-For", "9.9.9.9, 8.8.8.8")
	if ClientIP(req, true) != "9.9.9.9" {
		t.Fatal(ClientIP(req, true))
	}
	if ClientIP(req, false) != "1.2.3.4" {
		t.Fatal("should not trust proxy")
	}
}
