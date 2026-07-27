package paging

import "testing"

func TestNormalize(t *testing.T) {
	p, s := Normalize(0, 0, 10, 100)
	if p != 1 || s != 10 {
		t.Fatalf("got %d %d", p, s)
	}
	p, s = Normalize(2, 200, 10, 100)
	if p != 2 || s != 100 {
		t.Fatalf("got %d %d", p, s)
	}
}

func TestOffset(t *testing.T) {
	if Offset(1, 10) != 0 || Offset(3, 20) != 40 {
		t.Fatal("offset wrong")
	}
}
