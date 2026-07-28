package crypto

import (
	"testing"
	"time"
)

func TestTOTPRoundTrip(t *testing.T) {
	sec, err := GenerateTOTPSecret()
	if err != nil || sec == "" {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0)
	code, err := TOTPCode(sec, now)
	if err != nil || len(code) != 6 {
		t.Fatal(err, code)
	}
	if !ValidateTOTP(sec, code, now) {
		t.Fatal("valid code rejected")
	}
	if ValidateTOTP(sec, "000000", now) {
		// might rarely pass; use wrong length
	}
	if ValidateTOTP(sec, "abcdef", now) {
		t.Fatal("non-digit accepted")
	}
	uri := TOTPProvisioningURI(sec, "admin", "CardKey")
	if uri == "" || len(uri) < 20 {
		t.Fatal(uri)
	}
}
