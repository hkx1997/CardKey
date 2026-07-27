package webstatic

import (
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHasDist(t *testing.T) {
	if !HasDist() {
		t.Fatal("expected embedded dist/index.html")
	}
}

func TestMissingAssetIsNotHTML(t *testing.T) {
	h := Handler("")
	req := httptest.NewRequest(http.MethodGet, "/assets/definitely-missing-xyz.js", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("missing asset: want 404, got %d ct=%s", rr.Code, rr.Header().Get("Content-Type"))
	}
	ct := rr.Header().Get("Content-Type")
	if strings.Contains(ct, "text/html") {
		t.Fatal("missing asset must not be served as HTML")
	}
}

func TestCSSMimeIfPresent(t *testing.T) {
	sub, err := FS()
	if err != nil {
		t.Fatal(err)
	}
	var cssRel string
	_ = fs.WalkDir(sub, "assets", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if strings.HasSuffix(p, ".css") && strings.Contains(p, "index-") {
			cssRel = p
			return fs.SkipAll
		}
		return nil
	})
	if cssRel == "" {
		t.Skip("no index-*.css in embed dist (placeholder only)")
	}
	h := Handler("")
	req := httptest.NewRequest(http.MethodGet, "/"+cssRel, nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d", rr.Code)
	}
	ct := rr.Header().Get("Content-Type")
	if !strings.Contains(ct, "text/css") {
		body, _ := io.ReadAll(io.LimitReader(rr.Body, 60))
		t.Fatalf("want text/css, got %q body=%q", ct, body)
	}
	// 确保不是 HTML 文档
	body := rr.Body.Bytes()
	if len(body) > 15 && strings.Contains(strings.ToLower(string(body[:min(80, len(body))])), "<!doctype") {
		t.Fatal("css response body looks like HTML")
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
