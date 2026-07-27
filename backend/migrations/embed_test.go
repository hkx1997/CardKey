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
	// 至少包含初始迁移
	foundInit := false
	for _, n := range sqls {
		if n == "001_init.sql" {
			foundInit = true
			break
		}
	}
	if !foundInit {
		t.Fatalf("expected 001_init.sql in embed, got %v", sqls)
	}
}
