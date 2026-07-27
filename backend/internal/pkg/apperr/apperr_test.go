package apperr

import "testing"

func TestAs(t *testing.T) {
	e := Validation("bad")
	got, ok := As(e)
	if !ok || got.Code != "VALIDATION_ERROR" || got.HTTPStatus != 400 {
		t.Fatalf("%+v", got)
	}
	if _, ok := As(nil); ok {
		t.Fatal("nil should not convert")
	}
}
