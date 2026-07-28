package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAssertLinuxBinaryOK_RejectsSmall(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "tiny")
	// ELF magic but too small
	data := append([]byte{0x7f, 'E', 'L', 'F'}, make([]byte, 1000)...)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	err := assertLinuxBinaryOK(p)
	if err == nil {
		t.Fatal("expected reject small binary")
	}
}

func TestAssertLinuxBinaryOK_RejectsNonELF(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "html")
	// large enough but HTML
	payload := make([]byte, MinLinuxSPABinaryBytes)
	copy(payload, []byte("<!DOCTYPE html>"))
	if err := os.WriteFile(p, payload, 0o644); err != nil {
		t.Fatal(err)
	}
	err := assertLinuxBinaryOK(p)
	if err == nil {
		t.Fatal("expected reject non-ELF")
	}
}

func TestAssertLinuxBinaryOK_AcceptsELFLarge(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "ok")
	payload := make([]byte, MinLinuxSPABinaryBytes)
	payload[0], payload[1], payload[2], payload[3] = 0x7f, 'E', 'L', 'F'
	if err := os.WriteFile(p, payload, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := assertLinuxBinaryOK(p); err != nil {
		t.Fatal(err)
	}
}
