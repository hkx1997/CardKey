package config

import "testing"

func TestValidateProduction_RejectsWeakSecrets(t *testing.T) {
	c := Config{
		Env:           "production",
		JWTSecret:     "cardkey-local-dev-jwt-secret-please-rotate-xx",
		ContentKeyHex: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		CSRFCheck:     true,
		RequireRedis:  true,
		SecureCookie:  true,
		MetricsToken:  "metrics-token-for-tests-only",
		DatabaseURL:   "postgres://u:p@localhost/db?sslmode=require",
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

func TestValidateProduction_AllowsDockerDefaults(t *testing.T) {
	c := Config{
		Env:           "production",
		JWTSecret:     "this-is-a-strong-enough-jwt-secret-value-32+",
		ContentKeyHex: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
		CSRFCheck:     false,
		RequireRedis:  false,
		SecureCookie:  false,
		MetricsToken:  "",
		DatabaseURL:   "postgres://u:p@postgres:5432/db?sslmode=disable",
	}
	if err := c.ValidateProduction(); err != nil {
		t.Fatalf("docker defaults must boot: %v", err)
	}
}

func TestProductionWarnings_EmitsAdvisories(t *testing.T) {
	c := Config{
		Env:          "production",
		CSRFCheck:    false,
		MetricsToken: "",
		RequireRedis: false,
		SecureCookie: false,
		DatabaseURL:  "postgres://u:p@postgres:5432/db?sslmode=disable",
	}
	ws := c.ProductionWarnings()
	if len(ws) < 3 {
		t.Fatalf("expected multiple warnings, got %d: %+v", len(ws), ws)
	}
	codes := map[string]bool{}
	for _, w := range ws {
		codes[w.Code] = true
	}
	for _, want := range []string{"csrf_disabled", "metrics_open", "db_ssl_disable"} {
		if !codes[want] {
			t.Fatalf("missing warning %s in %+v", want, ws)
		}
	}
}

func TestProductionWarnings_SkipsNonProd(t *testing.T) {
	c := Config{Env: "development", CSRFCheck: false}
	if ws := c.ProductionWarnings(); len(ws) != 0 {
		t.Fatalf("expected none, got %+v", ws)
	}
}
