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
	if a.RDB != nil {
		_ = a.RDB.Del(ctx, "cardkey:public_stock_v1").Err()
	}
}

// ReconcileCategoryStock 全量对账类别 unused_count（正确性优先）。
func (a *App) ReconcileCategoryStock(ctx context.Context) (int, error) {
	tag, err := a.Pool.Exec(ctx, `
		UPDATE categories c SET unused_count = sub.cnt, updated_at=now()
		FROM (
			SELECT c2.id,
				(SELECT COUNT(*)::int FROM cards
				 WHERE category_id=c2.id AND status='unused'
				   AND (expires_at IS NULL OR expires_at > now())) AS cnt
			FROM categories c2
		) sub
		WHERE c.id = sub.id AND c.unused_count IS DISTINCT FROM sub.cnt`)
	if err != nil {
		return 0, err
	}
	n := int(tag.RowsAffected())
	if n > 0 && a.RDB != nil {
		_ = a.RDB.Del(ctx, "cardkey:public_stock_v1").Err()
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
