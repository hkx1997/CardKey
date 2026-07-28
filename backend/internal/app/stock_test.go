package app

import (
	"strings"
	"testing"
)

func TestAvailableStockSQL(t *testing.T) {
	s := AvailableStockSQL("cards")
	if s == "" {
		t.Fatal("empty")
	}
	if !strings.Contains(s, "cards.status = 'unused'") {
		t.Fatalf("unexpected: %q", s)
	}
}
