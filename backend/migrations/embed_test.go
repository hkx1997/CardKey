package migrations

import (
	"strings"
	"testing"
)

func TestEmbeddedSQLPresent(t *testing.T) {
	entries, err := FS.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	var sqls []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			sqls = append(sqls, e.Name())
		}
	}
	if len(sqls) == 0 {
		t.Fatal("embedded migrations FS has no *.sql — online update would not ship schema changes")
	}
	// 至少包含初始迁移 + 幂等/Webhook 表 + payload TEXT 修复
	need := map[string]bool{
		"001_init.sql":                 false,
		"005_webhook_idempotency.sql":  false,
		"006_webhook_payload_text.sql": false,
		"007_platform_hardening.sql":   false,
	}
	for _, n := range sqls {
		if _, ok := need[n]; ok {
			need[n] = true
		}
	}
	for name, ok := range need {
		if !ok {
			t.Fatalf("expected %s in embed, got %v", name, sqls)
		}
	}
}
