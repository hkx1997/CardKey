import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { queryKeys } from "@/shared/lib/query-keys";

/**
 * 统一缓存刷新策略（优先体感速度）：
 * - bump：标记过期 + 后台刷新活跃查询（不 await）
 * - refetchActive：仅 await 当前页主列表，避免串行等一堆无关接口
 */
export function useInvalidate() {
  const qc = useQueryClient();

  /** 不阻塞 UI：失效并后台 refetch 活跃查询 */
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

  /** 只等主列表（当前挂载的查询） */
  const refetchActive = useCallback(
    async (...keys: readonly (readonly unknown[])[]) => {
      await Promise.all(
        keys.map((key) =>
          qc.refetchQueries({
            queryKey: [...key],
            type: "active",
            exact: false,
          }),
        ),
      );
    },
    [qc],
  );

  return useMemo(
    () => ({
      qc,
      bump,
      refetchActive,

      /** 类别：先闪主列表，其它后台 */
      categories: async () => {
        await refetchActive(queryKeys.categories);
        bump(
          queryKeys.publicConfig,
          queryKeys.publicCategoryStock,
          queryKeys.dashboard,
          queryKeys.cards(),
          queryKeys.batches,
        );
      },

      /** 卡密：先闪卡密列表 */
      cards: async () => {
        await refetchActive(queryKeys.cards());
        bump(
          queryKeys.dashboard,
          queryKeys.categories,
          queryKeys.batches,
          queryKeys.publicCategoryStock,
          queryKeys.publicConfig,
        );
      },

      card: (id: string) => {
        bump(queryKeys.card(id, false), queryKeys.card(id, true));
      },

      batches: async () => {
        await refetchActive(queryKeys.batches);
        bump(
          queryKeys.cards(),
          queryKeys.dashboard,
          queryKeys.categories,
          queryKeys.publicCategoryStock,
        );
      },

      settings: async () => {
        await refetchActive(queryKeys.settings);
        bump(
          queryKeys.publicConfig,
          queryKeys.publicCategoryStock,
          queryKeys.apiKeys,
        );
      },

      apiKeys: async () => {
        await refetchActive(queryKeys.apiKeys);
        bump(
          queryKeys.dashboard,
          queryKeys.settings,
          queryKeys.publicConfig,
        );
      },

      dashboard: () => {
        bump(queryKeys.dashboard, queryKeys.runtimeMetrics);
      },

      redeems: async () => {
        await refetchActive(queryKeys.redeems());
        bump(queryKeys.dashboard, queryKeys.categories);
      },

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
    [qc, bump, refetchActive],
  );
}
