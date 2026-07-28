import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { queryKeys } from "@/shared/lib/query-keys";

/**
 * 统一缓存刷新（偏快、少风暴）：
 * - 主列表优先靠 mutation 的 setQueryData 即时更新
 * - 这里只做必要后台 invalidate，避免卡片一动就拉满 dashboard/categories/batches
 */
export function useInvalidate() {
  const qc = useQueryClient();

  /** 标记过期并后台刷新活跃查询（不 await） */
  const bump = useCallback(
    (...keys: readonly (readonly unknown[])[]) => {
      for (const key of keys) {
        void qc.invalidateQueries({
          queryKey: [...key],
          exact: false,
          refetchType: "active",
        });
      }
    },
    [qc],
  );

  return useMemo(
    () => ({
      qc,
      bump,

      categories: () =>
        bump(
          queryKeys.categories,
          queryKeys.publicCategoryStock,
          // 类别变更会影响筛选与看板分类，但不同步刷全部卡密列表
          queryKeys.dashboard,
        ),

      cards: () =>
        bump(
          queryKeys.cards(),
          // 库存物化相关：公开展示 + 类别 unused
          queryKeys.publicCategoryStock,
          queryKeys.categories,
          // 看板延后由用户进入时再拉（staleTime 内可能仍旧；主动进 dashboard 会刷新）
        ),

      /** 大批量导入/批次删除后：才联动批次与看板 */
      cardsHeavy: () =>
        bump(
          queryKeys.cards(),
          queryKeys.batches,
          queryKeys.dashboard,
          queryKeys.categories,
          queryKeys.publicCategoryStock,
        ),

      card: (id: string) => {
        bump(queryKeys.card(id, false), queryKeys.card(id, true));
      },

      batches: () =>
        bump(
          queryKeys.batches,
          queryKeys.cards(),
          queryKeys.categories,
          queryKeys.publicCategoryStock,
        ),

      settings: () =>
        bump(
          queryKeys.settings,
          queryKeys.publicConfig,
          queryKeys.publicCategoryStock,
          queryKeys.apiKeys,
        ),

      apiKeys: () =>
        bump(queryKeys.apiKeys, queryKeys.settings, queryKeys.publicConfig),

      dashboard: () => {
        bump(queryKeys.dashboard, queryKeys.runtimeMetrics);
      },

      redeems: () => bump(queryKeys.redeems(), queryKeys.dashboard),

      system: () => {
        bump(
          queryKeys.systemInfo,
          queryKeys.updateHistory,
          queryKeys.runtimeMetrics,
        );
      },

      audit: () => {
        bump(queryKeys.audit());
      },

      public: () => {
        bump(queryKeys.publicConfig, queryKeys.publicCategoryStock);
      },
    }),
    [qc, bump],
  );
}
