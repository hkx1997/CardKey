package app

import (
	"context"
	"time"
)

// MarkExpiredCards 将已过期未使用的卡密标记为 expired，并在同一事务中扣减物化库存。
func (a *App) MarkExpiredCards(ctx context.Context) (int64, error) {
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 先按类别统计将要过期的数量，再更新状态，最后扣库存（同事务）
	rows, err := tx.Query(ctx, `
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
	if len(bumps) == 0 {
		return 0, nil
	}

	tag, err := tx.Exec(ctx, `
		UPDATE cards SET status='expired', updated_at=now()
		WHERE status='unused' AND expires_at IS NOT NULL AND expires_at < now()`)
	if err != nil {
		return 0, err
	}
	for _, p := range bumps {
		if _, err := tx.Exec(ctx, `
			UPDATE categories SET unused_count = GREATEST(0, unused_count - $2), updated_at=now()
			WHERE id=$1::uuid`, p.id, p.n); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	if a.RDB != nil {
		_ = a.RDB.Del(ctx, "cardkey:public_stock_v1").Err()
	}
	return tag.RowsAffected(), nil
}

// StartBackgroundJobs 启动周期任务（过期清理、库存对账、邮件预警等）。
func (a *App) StartBackgroundJobs(ctx context.Context) {
	a.StartAuditWorker(ctx)
	// Webhook 更勤：30s 一轮 SKIP LOCKED
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				wctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
				if wn, werr := a.ProcessDueWebhooks(wctx, 40); werr != nil {
					if a.Log != nil {
						a.Log.Warn("webhook worker failed", "err", werr)
					}
				} else if wn > 0 && a.Log != nil {
					a.Log.Info("webhook worker processed", "count", wn)
				}
				cancel()
			}
		}
	}()
	go func() {
		t := time.NewTicker(5 * time.Minute)
		defer t.Stop()

		runCycle := func(label string) {
			// 过期清理（事务内扣库存）
			cctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			n, err := a.MarkExpiredCards(cctx)
			cancel()
			if err != nil {
				if a.Log != nil {
					a.Log.Warn("expire job failed", "err", err, "phase", label)
				}
			} else if n > 0 && a.Log != nil {
				a.Log.Info("expired cards marked", "count", n, "phase", label)
			}

			// 库存全量对账（补偿非事务 bump 漂移）
			sctx, scancel := context.WithTimeout(context.Background(), 90*time.Second)
			if rn, rerr := a.ReconcileCategoryStock(sctx); rerr != nil {
				if a.Log != nil {
					a.Log.Warn("stock reconcile failed", "err", rerr, "phase", label)
				}
			} else if rn > 0 && a.Log != nil {
				a.Log.Info("stock reconcile corrected", "categories", rn, "phase", label)
			}
			// 异步导入
			a.ProcessPendingImportJobs(sctx, 3)
			scancel()

			// 邮件预警
			mctx, mcancel := context.WithTimeout(context.Background(), 45*time.Second)
			a.EvaluateMailAlerts(mctx)
			mcancel()
		}

		// 启动后立即对账 + 过期（修复重启前漂移）
		runCycle("startup")

		// 邮件预警稍晚，避免启动风暴（startup 周期已含一次；此处仅额外延迟一次）
		go func() {
			time.Sleep(45 * time.Second)
			mctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			a.EvaluateMailAlerts(mctx)
			cancel()
		}()

		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				runCycle("tick")
			}
		}
	}()
}
