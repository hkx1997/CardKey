package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRunBinarySelfTest_RejectsNonELF(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "fake")
	payload := make([]byte, MinLinuxSPABinaryBytes)
	copy(payload, []byte("<html>"))
	if err := os.WriteFile(p, payload, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := RunBinarySelfTest(p); err == nil {
		t.Fatal("expected reject")
	}
}
