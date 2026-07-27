package app

import (
	"context"
	"time"
)

// MarkExpiredCards 将已过期未使用的卡密标记为 expired。
func (a *App) MarkExpiredCards(ctx context.Context) (int64, error) {
	tag, err := a.Pool.Exec(ctx, `
		UPDATE cards SET status='expired', updated_at=now()
		WHERE status='unused' AND expires_at IS NOT NULL AND expires_at < now()`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// StartBackgroundJobs 启动周期任务（过期清理等）。
func (a *App) StartBackgroundJobs(ctx context.Context) {
	go func() {
		t := time.NewTicker(5 * time.Minute)
		defer t.Stop()
		// 启动后立即跑一次
		if n, err := a.MarkExpiredCards(ctx); err != nil {
			a.Log.Warn("expire job failed", "err", err)
		} else if n > 0 {
			a.Log.Info("expired cards marked", "count", n)
		}
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				cctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				n, err := a.MarkExpiredCards(cctx)
				cancel()
				if err != nil {
					a.Log.Warn("expire job failed", "err", err)
				} else if n > 0 {
					a.Log.Info("expired cards marked", "count", n)
				}
			}
		}
	}()
}
