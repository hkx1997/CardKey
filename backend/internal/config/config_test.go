package config

import "testing"

func TestValidateProduction_RejectsWeakSecrets(t *testing.T) {
	c := Config{
		Env:           "production",
		JWTSecret:     "cardkey-local-dev-jwt-secret-please-rotate-xx",
		ContentKeyHex: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
	}
	if err := c.ValidateProduction(); err == nil {
		t.Fatal("expected error for weak jwt")
	}
	c.JWTSecret = "this-is-a-strong-enough-jwt-secret-value-32+"
	if err := c.ValidateProduction(); err == nil {
		t.Fatal("expected error for example content key")
	}
	c.ContentKeyHex = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"
	if err := c.ValidateProduction(); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func TestValidateProduction_SkipsNonProd(t *testing.T) {
	c := Config{Env: "development", JWTSecret: "x"}
	if err := c.ValidateProduction(); err != nil {
		t.Fatal(err)
	}
}
