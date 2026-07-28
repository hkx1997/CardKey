import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { queryKeys } from "@/shared/lib/query-keys";

/**
 * 统一缓存刷新（偏快）：
 * - 主列表优先靠 mutation 的 setQueryData 即时更新
 * - 这里只做后台 invalidate（不阻塞 toast / 关弹窗）
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
          queryKeys.publicConfig,
          queryKeys.publicCategoryStock,
          queryKeys.dashboard,
          queryKeys.cards(),
          queryKeys.batches,
        ),

      cards: () =>
        bump(
          queryKeys.cards(),
          queryKeys.dashboard,
          queryKeys.categories,
          queryKeys.batches,
          queryKeys.publicCategoryStock,
          queryKeys.publicConfig,
        ),

      card: (id: string) => {
        bump(queryKeys.card(id, false), queryKeys.card(id, true));
      },

      batches: () =>
        bump(
          queryKeys.batches,
          queryKeys.cards(),
          queryKeys.dashboard,
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
        bump(
          queryKeys.apiKeys,
          queryKeys.dashboard,
          queryKeys.settings,
          queryKeys.publicConfig,
        ),

      dashboard: () => {
        bump(queryKeys.dashboard, queryKeys.runtimeMetrics);
      },

      redeems: () =>
        bump(queryKeys.redeems(), queryKeys.dashboard, queryKeys.categories),

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
