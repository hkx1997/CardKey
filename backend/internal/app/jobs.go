package app

import (
	"context"
	"time"
)

// MarkExpiredCards 将已过期未使用的卡密标记为 expired，并扣减物化库存。
func (a *App) MarkExpiredCards(ctx context.Context) (int64, error) {
	rows, err := a.Pool.Query(ctx, `
		SELECT category_id::text, COUNT(*)::int FROM cards
		WHERE status='unused' AND expires_at IS NOT NULL AND expires_at < now()
		GROUP BY category_id`)
	if err != nil {
		return 0, err
	}
	type pair struct {
		id string
		n  int
	}
	var bumps []pair
	for rows.Next() {
		var p pair
		if err := rows.Scan(&p.id, &p.n); err != nil {
			rows.Close()
			return 0, err
		}
		bumps = append(bumps, p)
	}
	rows.Close()
	tag, err := a.Pool.Exec(ctx, `
		UPDATE cards SET status='expired', updated_at=now()
		WHERE status='unused' AND expires_at IS NOT NULL AND expires_at < now()`)
	if err != nil {
		return 0, err
	}
	for _, p := range bumps {
		a.bumpUnusedCount(ctx, p.id, -p.n)
	}
	return tag.RowsAffected(), nil
}

// StartBackgroundJobs 启动周期任务（过期清理、邮件预警等）。
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
		// 邮件预警稍后一点再跑，避免启动风暴
		go func() {
			time.Sleep(45 * time.Second)
			cctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			a.EvaluateMailAlerts(cctx)
			cancel()
		}()
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
				// Webhook 可靠投递重试
				wctx, wcancel := context.WithTimeout(context.Background(), 45*time.Second)
				if wn, werr := a.ProcessDueWebhooks(wctx, 50); werr != nil {
					a.Log.Warn("webhook outbox job failed", "err", werr)
				} else if wn > 0 && a.Log != nil {
					a.Log.Info("webhook outbox processed", "count", wn)
				}
				wcancel()
				// 库存对账 + 异步导入
				sctx, scancel := context.WithTimeout(context.Background(), 60*time.Second)
				if _, err := a.ReconcileCategoryStock(sctx); err != nil && a.Log != nil {
					a.Log.Warn("stock reconcile failed", "err", err)
				}
				a.ProcessPendingImportJobs(sctx, 3)
				scancel()
				// 邮件预警与过期清理同周期
				mctx, mcancel := context.WithTimeout(context.Background(), 45*time.Second)
				a.EvaluateMailAlerts(mctx)
				mcancel()
			}
		}
	}()
}
