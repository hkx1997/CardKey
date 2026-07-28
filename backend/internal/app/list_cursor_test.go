package app

import (
	"testing"
	"time"
)

func TestListCursorRoundTrip(t *testing.T) {
	at := time.Date(2026, 7, 28, 12, 0, 0, 123456789, time.UTC)
	id := "550e8400-e29b-41d4-a716-446655440000"
	enc := encodeListCursor(at, id)
	cur, ok := decodeListCursor(enc)
	if !ok {
		t.Fatal("decode failed")
	}
	if cur.ID != id {
		t.Fatalf("id %q", cur.ID)
	}
	if !cur.At.Equal(at) {
		t.Fatalf("time got %v want %v", cur.At, at)
	}
}

func TestListCursorEmpty(t *testing.T) {
	if _, ok := decodeListCursor(""); ok {
		t.Fatal("expected fail")
	}
	if encodeListCursor(time.Time{}, "x") != "" {
		t.Fatal("zero time should empty")
	}
}
