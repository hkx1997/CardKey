package app

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/cardkey/cardkey/internal/db"
)

// TestMain 尽量保证集成测有可用 Postgres（docker cardkey-test-pg:25432）。
func TestMain(m *testing.M) {
	ensureTestPostgres()
	os.Exit(m.Run())
}

func ensureTestPostgres() {
	if os.Getenv("CARDKEY_TEST_DATABASE_URL") != "" {
		return
	}
	url := testDBURL()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if pool, err := db.ConnectWithPool(ctx, url, 2, 0); err == nil {
		pool.Close()
		return
	}
	// 尝试拉起 docker 容器
	_ = exec.Command("docker", "rm", "-f", "cardkey-test-pg").Run()
	cmd := exec.Command("docker", "run", "-d", "--name", "cardkey-test-pg",
		"-e", "POSTGRES_USER=cardkey",
		"-e", "POSTGRES_PASSWORD=cardkey",
		"-e", "POSTGRES_DB=cardkey",
		"-p", "25432:5432",
		"postgres:16-alpine")
	if out, err := cmd.CombinedOutput(); err != nil {
		fmt.Fprintf(os.Stderr, "cardkey test: docker pg start failed: %v %s\n", err, out)
		return
	}
	for i := 0; i < 40; i++ {
		time.Sleep(500 * time.Millisecond)
		cctx, ccancel := context.WithTimeout(context.Background(), 2*time.Second)
		pool, err := db.ConnectWithPool(cctx, url, 2, 0)
		ccancel()
		if err == nil {
			pool.Close()
			fmt.Fprintln(os.Stderr, "cardkey test: postgres ready on :25432")
			return
		}
	}
	fmt.Fprintln(os.Stderr, "cardkey test: postgres still unavailable after docker start")
}
