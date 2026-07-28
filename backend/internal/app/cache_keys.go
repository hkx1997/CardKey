package app

import (
	"context"
	"time"
)

// Redis / 进程缓存键：读写与失效必须用同一常量，禁止手写旧版本号。
// 历史教训：public_config 升到 v3 后失效仍删 v2 → 轮换兑换密钥后公开页最长 20s 仍旧。
const (
	redisPublicConfigV2     = "cardkey:public_config_v2" // 兼容清理
	redisPublicConfigV3     = "cardkey:public_config_v3"
	redisPublicConfigCurrent = redisPublicConfigV3
	redisPublicStock        = "cardkey:public_stock_v1"
	redisCardStatusCounts   = "cardkey:card_status_counts_v1"

	// 公开配置 Redis TTL：仅作多实例短合并，写路径必须主动失效
	publicConfigRedisTTL = 8 * time.Second
	publicStockRedisTTL  = 5 * time.Second
)

// InvalidatePublicConfigCache 设置 / 类别 / 密钥变更后必须调用。
func (a *App) InvalidatePublicConfigCache(ctx context.Context) {
	if a == nil || a.RDB == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	// 新旧键一并删，避免再踩版本漂移
	_ = a.RDB.Del(ctx, redisPublicConfigV2, redisPublicConfigV3).Err()
}

// InvalidatePublicStockCache 库存物化变更后调用（兑换/导入/启用类别等）。
func (a *App) InvalidatePublicStockCache(ctx context.Context) {
	if a == nil || a.RDB == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	_ = a.RDB.Del(ctx, redisPublicStock).Err()
}

func (a *App) invalidatePublicFacingCaches(ctx context.Context) {
	a.InvalidatePublicConfigCache(ctx)
	a.InvalidatePublicStockCache(ctx)
}
