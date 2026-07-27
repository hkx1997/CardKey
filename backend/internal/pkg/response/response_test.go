package response

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/cardkey/cardkey/internal/pkg/apperr"
)

func TestOKEnvelope(t *testing.T) {
	rr := httptest.NewRecorder()
	OK(rr, map[string]string{"hello": "world"})
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d", rr.Code)
	}
	var env map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	if env["success"] != true {
		t.Fatalf("%v", env)
	}
	data, ok := env["data"].(map[string]any)
	if !ok || data["hello"] != "world" {
		t.Fatalf("%v", env["data"])
	}
}

func TestFailEnvelope(t *testing.T) {
	rr := httptest.NewRecorder()
	Fail(rr, apperr.Validation("bad input"))
	if rr.Code != 400 {
		t.Fatalf("status %d", rr.Code)
	}
	var env map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &env)
	if env["success"] != false {
		t.Fatal(env)
	}
	errObj, _ := env["error"].(map[string]any)
	if errObj["code"] != "VALIDATION_ERROR" {
		t.Fatalf("%v", errObj)
	}
}
