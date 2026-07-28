package app

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cardkey/cardkey/internal/domain"
	"github.com/cardkey/cardkey/internal/pkg/apperr"
)

func TestRedeem_SuccessUsedAndCrossCategory(t *testing.T) {
	a, cleanup := openTestApp(t)
	defer cleanup()
	mustPool(t, a)
	s := seedRedeemable(t, a, "SECRET-CONTENT-1")
	ctx := context.Background()

	// success
	res, err := a.Redeem(ctx, s.Slug, s.Code, "10.0.0.1", "test-ua", "", "")
	if err != nil {
		t.Fatalf("redeem: %v", err)
	}
	if res.Status != "success" {
		t.Fatalf("status=%s", res.Status)
	}
	if res.Content != "SECRET-CONTENT-1" {
		t.Fatalf("content=%q", res.Content)
	}

	// already used (allow requery default true → already_redeemed)
	res2, err := a.Redeem(ctx, s.Slug, s.Code, "10.0.0.1", "test-ua", "", "")
	if err != nil {
		// if AllowRequery false would error; default true
		t.Fatalf("second redeem: %v", err)
	}
	if res2.Status != "already_redeemed" && res2.Status != "success" {
		// success only if somehow not marked — fail hard
		t.Fatalf("expected already_redeemed, got %s", res2.Status)
	}
	if res2.Status == "success" {
		t.Fatal("double success would mean double consumption")
	}

	// cross-category: other slug must not redeem this code
	s2 := seedRedeemable(t, a, "OTHER")
	_, err = a.Redeem(ctx, s2.Slug, s.Code, "10.0.0.1", "ua", "", "")
	if err == nil {
		t.Fatal("expected cross-category failure")
	}
	if ae, ok := apperr.As(err); !ok || ae.HTTPStatus == 0 {
		// any error is fine; prefer CARD_INVALID
		t.Logf("cross-category err: %v", err)
	}

	// inventory: card status used
	var st string
	if err := a.Pool.QueryRow(ctx, `SELECT status FROM cards WHERE id=$1::uuid`, s.CardID).Scan(&st); err != nil {
		t.Fatal(err)
	}
	if st != string(domain.StatusUsed) {
		t.Fatalf("card status=%s", st)
	}
}

func TestRedeem_ConcurrentDoubleRedeem_SingleSuccess(t *testing.T) {
	a, cleanup := openTestApp(t)
	defer cleanup()
	mustPool(t, a)
	s := seedRedeemable(t, a, "CONCURRENT-PAYLOAD")
	ctx := context.Background()

	const n = 20
	var success atomic.Int32
	var usedOrErr atomic.Int32
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			res, err := a.Redeem(ctx, s.Slug, s.Code, "10.0.0.9", "conc", "", "")
			if err != nil {
				usedOrErr.Add(1)
				return
			}
			if res.Status == "success" {
				success.Add(1)
			} else {
				usedOrErr.Add(1)
			}
		}()
	}
	wg.Wait()

	if success.Load() != 1 {
		t.Fatalf("expected exactly 1 success, got %d (other=%d)", success.Load(), usedOrErr.Load())
	}
	var st string
	if err := a.Pool.QueryRow(ctx, `SELECT status FROM cards WHERE id=$1::uuid`, s.CardID).Scan(&st); err != nil {
		t.Fatal(err)
	}
	if st != string(domain.StatusUsed) {
		t.Fatalf("status=%s", st)
	}
	var cnt int
	if err := a.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM redeem_records WHERE card_id=$1::uuid`, s.CardID).Scan(&cnt); err != nil {
		t.Fatal(err)
	}
	if cnt != 1 {
		t.Fatalf("redeem_records=%d", cnt)
	}
	t.Logf("concurrent double-redeem: success=1 records=1 (workers=%d)", n)
}

func TestBatchAction_DisableAndRestore(t *testing.T) {
	a, cleanup := openTestApp(t)
	defer cleanup()
	s := seedRedeemable(t, a, "BATCH")
	ctx := context.Background()

	// illegal: cannot restore unused (0 rows)
	n, err := a.BatchAction(ctx, []string{s.CardID}, "restore", "admin", "1.1.1.1")
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("restore unused affected %d", n)
	}

	n, err = a.BatchAction(ctx, []string{s.CardID}, "disable", "admin", "1.1.1.1")
	if err != nil || n != 1 {
		t.Fatalf("disable n=%d err=%v", n, err)
	}
	// disabled cannot redeem
	_, err = a.Redeem(ctx, s.Slug, s.Code, "1.1.1.1", "ua", "", "")
	if err == nil {
		t.Fatal("expected disabled redeem fail")
	}

	n, err = a.BatchAction(ctx, []string{s.CardID}, "enable", "admin", "1.1.1.1")
	if err != nil || n != 1 {
		t.Fatalf("enable n=%d err=%v", n, err)
	}
	res, err := a.Redeem(ctx, s.Slug, s.Code, "1.1.1.1", "ua", "", "")
	if err != nil || res.Status != "success" {
		t.Fatalf("redeem after enable: %v %#v", err, res)
	}
}

func TestRedeem_IdempotencyKey_NoDoubleConsume(t *testing.T) {
	a, cleanup := openTestApp(t)
	defer cleanup()
	s := seedRedeemable(t, a, "IDEM-BODY")
	ctx := context.Background()
	key := "idem-" + s.CardID

	r1, err := a.RedeemWithIdempotency(ctx, s.Slug, s.Code, "2.2.2.2", "ua", "", "", key)
	if err != nil || r1.Status != "success" {
		t.Fatalf("first: %v %#v", err, r1)
	}
	r2, err := a.RedeemWithIdempotency(ctx, s.Slug, s.Code, "2.2.2.2", "ua", "", "", key)
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if r2.Status != "success" {
		t.Fatalf("idempotent replay status=%s", r2.Status)
	}
	if r2.Content != r1.Content {
		t.Fatalf("content mismatch")
	}
	var cnt int
	if err := a.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM redeem_records WHERE card_id=$1::uuid`, s.CardID).Scan(&cnt); err != nil {
		t.Fatal(err)
	}
	if cnt != 1 {
		t.Fatalf("expected 1 redeem record, got %d", cnt)
	}
}

func TestWebhookOutbox_RetryAfterFailure(t *testing.T) {
	a, cleanup := openTestApp(t)
	defer cleanup()
	ctx := context.Background()

	const secret = "sec"
	// 故意用不稳定 key 顺序的稳定字节串（签名必须覆盖「实际 POST 的 body」）
	payload := []byte(`{"event":"redeem.success","code":"X","z":1,"a":2}`)
	wantSig := SignWebhookBody(secret, payload)

	// local server: fail once then succeed; assert HMAC(header) == HMAC(body)
	var hits atomic.Int32
	var mu sync.Mutex
	var lastBody []byte
	var lastSig string
	var handlerErrs []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := hits.Add(1)
		body, _ := ioReadAll(r)
		sigHdr := r.Header.Get("X-CardKey-Signature")
		mu.Lock()
		lastBody = append([]byte(nil), body...)
		lastSig = sigHdr
		// 关键：签名必须等于对「实际收到的 body」计算的 HMAC（防 JSONB 往返破坏）
		if got := SignWebhookBody(secret, body); got != sigHdr {
			handlerErrs = append(handlerErrs, fmt.Sprintf("hit %d: signature mismatch header=%q hmac(body)=%q body=%q", n, sigHdr, got, body))
		}
		if string(body) != string(payload) {
			handlerErrs = append(handlerErrs, fmt.Sprintf("hit %d: body mutated: got %q want %q", n, body, payload))
		}
		mu.Unlock()
		if n == 1 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()

	id, err := a.EnqueueWebhook(ctx, "redeem.success", srv.URL, payload, wantSig)
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	// 库内 payload 必须与入队字节一致（TEXT 精确存储）
	var stored string
	if err := a.Pool.QueryRow(ctx, `SELECT payload FROM webhook_outbox WHERE id=$1::uuid`, id).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != string(payload) {
		t.Fatalf("stored payload mutated: %q vs %q", stored, payload)
	}

	out1, err := a.ProcessWebhookOutboxByID(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if out1.Status != "failed" {
		t.Fatalf("first status=%s", out1.Status)
	}

	// force due
	_, _ = a.Pool.Exec(ctx, `UPDATE webhook_outbox SET next_attempt_at=now() - interval '1 second' WHERE id=$1::uuid`, id)
	out2, err := a.ProcessWebhookOutboxByID(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if out2.Status != "success" {
		t.Fatalf("retry status=%s err=%s", out2.Status, out2.LastError)
	}
	got, err := a.GetWebhookOutbox(ctx, id)
	if err != nil || got.Status != "success" {
		t.Fatalf("observable outcome: %#v %v", got, err)
	}
	if hits.Load() < 2 {
		t.Fatalf("hits=%d", hits.Load())
	}
	mu.Lock()
	defer mu.Unlock()
	if len(handlerErrs) > 0 {
		t.Fatalf("handler assertions: %v", handlerErrs)
	}
	if SignWebhookBody(secret, lastBody) != lastSig || lastSig != wantSig {
		t.Fatalf("final delivery sig still wrong: lastSig=%q want=%q body=%q", lastSig, wantSig, lastBody)
	}
}

func ioReadAll(r *http.Request) ([]byte, error) {
	defer r.Body.Close()
	buf := make([]byte, 0, 512)
	tmp := make([]byte, 512)
	for {
		n, err := r.Body.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
		}
		if err != nil {
			break
		}
	}
	return buf, nil
}

// silence unused import if any
var _ = time.Second
