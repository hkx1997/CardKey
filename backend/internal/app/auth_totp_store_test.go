package app

import (
	"context"
	"testing"
)

func TestPendingTOTPMemoryFallback(t *testing.T) {
	a := &App{} // 无 Redis
	ctx := context.Background()
	adminID := "admin-test-1"
	pendingTOTP.Delete(adminID)

	secret, uri, err := a.BeginTOTPSetup(ctx, adminID, "admin")
	if err != nil {
		t.Fatal(err)
	}
	if secret == "" || uri == "" {
		t.Fatalf("empty secret/uri: %q %q", secret, uri)
	}
	got := a.loadPendingTOTP(ctx, adminID)
	if got != secret {
		t.Fatalf("load pending: got %q want %q", got, secret)
	}
	a.clearPendingTOTP(ctx, adminID)
	if a.loadPendingTOTP(ctx, adminID) != "" {
		t.Fatal("expected cleared")
	}
}

func TestLoginTicketMemoryFallback(t *testing.T) {
	a := &App{}
	ctx := context.Background()
	ticket, err := a.issueLoginTicket(ctx, "id1", "user1")
	if err != nil || ticket == "" {
		t.Fatalf("issue: %v %q", err, ticket)
	}
	id, user, err := a.consumeLoginTicket(ctx, ticket)
	if err != nil {
		t.Fatal(err)
	}
	if id != "id1" || user != "user1" {
		t.Fatalf("got %s %s", id, user)
	}
	// 二次消费应失败
	if _, _, err := a.consumeLoginTicket(ctx, ticket); err == nil {
		t.Fatal("expected second consume to fail")
	}
}
