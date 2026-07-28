package domain

import "testing"

func TestCanApplyBatchAction(t *testing.T) {
	cases := []struct {
		status CardStatus
		action BatchActionName
		want   bool
	}{
		{StatusUnused, BatchDisable, true},
		{StatusUsed, BatchDisable, false},
		{StatusDisabled, BatchDisable, false},
		{StatusExpired, BatchDisable, false},

		{StatusDisabled, BatchEnable, true},
		{StatusUsed, BatchRestore, true},
		{StatusUnused, BatchEnable, false},
		{StatusExpired, BatchRestore, false},

		{StatusUnused, BatchDelete, true},
		{StatusDisabled, BatchDelete, true},
		{StatusUsed, BatchDelete, false},
		{StatusExpired, BatchDelete, false},
	}
	for _, tc := range cases {
		got := CanApplyBatchAction(tc.status, tc.action)
		if got != tc.want {
			t.Fatalf("status=%s action=%s got=%v want=%v", tc.status, tc.action, got, tc.want)
		}
	}
}

func TestNormalizeBatchAction(t *testing.T) {
	if _, err := NormalizeBatchAction("nope"); err == nil {
		t.Fatal("expected error")
	}
	a, err := NormalizeBatchAction("restore")
	if err != nil || a != BatchRestore {
		t.Fatalf("got %v %v", a, err)
	}
}

func TestEvaluateRedeemStatus(t *testing.T) {
	if EvaluateRedeemStatus(StatusUnused) != RedeemOK {
		t.Fatal("unused")
	}
	if EvaluateRedeemStatus(StatusUsed) != RedeemUsed {
		t.Fatal("used")
	}
	if EvaluateRedeemStatus(StatusDisabled) != RedeemDisabled {
		t.Fatal("disabled")
	}
	if EvaluateRedeemStatus(StatusExpired) != RedeemExpired {
		t.Fatal("expired")
	}
}
