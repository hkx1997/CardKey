package app

import (
	"context"
	"fmt"
)

// bumpUnusedCount 调整类别可兑库存物化计数（delta 可正可负）。
func (a *App) bumpUnusedCount(ctx context.Context, categoryID string, delta int) {
	if a.Pool == nil || categoryID == "" || delta == 0 {
		return
	}
	_, _ = a.Pool.Exec(ctx, `
		UPDATE categories SET unused_count = GREATEST(0, unused_count + $2), updated_at=now()
		WHERE id=$1::uuid`, categoryID, delta)
	a.invalidateStockCaches(ctx)
}

// bumpCardStats 调整 card_count / used_count / unused_count（创建/删除/状态迁移）。
func (a *App) bumpCardStats(ctx context.Context, categoryID string, dCard, dUsed, dUnused int) {
	if a.Pool == nil || categoryID == "" {
		return
	}
	if dCard == 0 && dUsed == 0 && dUnused == 0 {
		return
	}
	_, _ = a.Pool.Exec(ctx, `
		UPDATE categories SET
			card_count = GREATEST(0, card_count + $2),
			used_count = GREATEST(0, used_count + $3),
			unused_count = GREATEST(0, unused_count + $4),
			updated_at = now()
		WHERE id=$1::uuid`, categoryID, dCard, dUsed, dUnused)
	a.invalidateStockCaches(ctx)
}

func (a *App) invalidateStockCaches(ctx context.Context) {
	if a.RDB != nil {
		_ = a.RDB.Del(ctx, "cardkey:public_stock_v1").Err()
		_ = a.RDB.Del(ctx, "cardkey:card_status_counts_v1").Err()
	}
	a.InvalidateDashboardCache()
}

// ReconcileCategoryStock 一次 GROUP BY 全量对账（正确性优先，替代相关子查询）。
func (a *App) ReconcileCategoryStock(ctx context.Context) (int, error) {
	tag, err := a.Pool.Exec(ctx, `
		UPDATE categories c SET
			card_count = COALESCE(sub.total, 0),
			used_count = COALESCE(sub.used, 0),
			unused_count = COALESCE(sub.unused, 0),
			updated_at = now()
		FROM (
			SELECT category_id,
				COUNT(*)::int AS total,
				COUNT(*) FILTER (WHERE status='used')::int AS used,
				COUNT(*) FILTER (
					WHERE status='unused' AND (expires_at IS NULL OR expires_at > now())
				)::int AS unused
			FROM cards
			GROUP BY category_id
		) sub
		WHERE c.id = sub.category_id
		  AND (
			c.card_count IS DISTINCT FROM COALESCE(sub.total, 0)
			OR c.used_count IS DISTINCT FROM COALESCE(sub.used, 0)
			OR c.unused_count IS DISTINCT FROM COALESCE(sub.unused, 0)
		)`)
	if err != nil {
		return 0, err
	}
	// 无卡的类别归零
	tag2, err := a.Pool.Exec(ctx, `
		UPDATE categories c SET card_count=0, used_count=0, unused_count=0, updated_at=now()
		WHERE NOT EXISTS (SELECT 1 FROM cards x WHERE x.category_id=c.id)
		  AND (c.card_count <> 0 OR c.used_count <> 0 OR c.unused_count <> 0)`)
	if err != nil {
		return int(tag.RowsAffected()), err
	}
	n := int(tag.RowsAffected() + tag2.RowsAffected())
	if n > 0 {
		a.invalidateStockCaches(ctx)
	}
	if a.Log != nil && n > 0 {
		a.Log.Info("stock reconciled", "categories", n)
	}
	return n, nil
}

// AvailableStockExpr 与物化一致的表达式（回退查询用）。
func AvailableStockSQL(alias string) string {
	if alias == "" {
		alias = "cards"
	}
	return fmt.Sprintf(
		`COUNT(%s.id) FILTER (WHERE %s.status = 'unused' AND (%s.expires_at IS NULL OR %s.expires_at > now()))`,
		alias, alias, alias, alias)
}
