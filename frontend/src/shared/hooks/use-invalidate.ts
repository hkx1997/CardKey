import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { queryKeys } from "@/shared/lib/query-keys";

/**
 * 统一失效 + 立即 refetch 活跃查询。
 * 页面 mutation 成功后必须走这里，避免「操作成功但列表不刷新」。
 */
export function useInvalidate() {
  const qc = useQueryClient();

  /** 标记过期并强制拉取当前挂载中的查询 */
  const refresh = useCallback(
    async (...keys: readonly (readonly unknown[])[]) => {
      await Promise.all(
        keys.map(async (key) => {
          const queryKey = [...key];
          await qc.invalidateQueries({ queryKey, exact: false });
          await qc.refetchQueries({
            queryKey,
            type: "active",
            exact: false,
          });
        }),
      );
    },
    [qc],
  );

  return useMemo(
    () => ({
      qc,
      refresh,
      /** 类别增删改：列表、公开配置/库存、仪表盘、卡密筛选、批次 */
      categories: () =>
        refresh(
          queryKeys.categories,
          queryKeys.publicConfig,
          queryKeys.publicCategoryStock,
          queryKeys.dashboard,
          queryKeys.cards(),
          queryKeys.batches,
        ),
      /** 卡密创建/导入/批量操作 */
      cards: () =>
        refresh(
          queryKeys.cards(),
          queryKeys.dashboard,
          queryKeys.categories,
          queryKeys.batches,
          queryKeys.publicCategoryStock,
          queryKeys.publicConfig,
        ),
      /** 单卡详情（reveal 等） */
      card: (id: string) =>
        refresh(queryKeys.card(id, false), queryKeys.card(id, true)),
      /** 批次删除等 */
      batches: () =>
        refresh(
          queryKeys.batches,
          queryKeys.cards(),
          queryKeys.dashboard,
          queryKeys.categories,
          queryKeys.publicCategoryStock,
        ),
      settings: () =>
        refresh(
          queryKeys.settings,
          queryKeys.publicConfig,
          queryKeys.publicCategoryStock,
          queryKeys.apiKeys,
        ),
      apiKeys: () =>
        refresh(
          queryKeys.apiKeys,
          queryKeys.dashboard,
          queryKeys.settings,
          queryKeys.publicConfig,
        ),
      dashboard: () =>
        refresh(queryKeys.dashboard, queryKeys.runtimeMetrics),
      redeems: () =>
        refresh(queryKeys.redeems(), queryKeys.dashboard, queryKeys.categories),
      system: () =>
        refresh(
          queryKeys.systemInfo,
          queryKeys.updateHistory,
          queryKeys.runtimeMetrics,
        ),
      audit: () => refresh(queryKeys.audit()),
      /** 公开兑换端配置与库存 */
      public: () =>
        refresh(queryKeys.publicConfig, queryKeys.publicCategoryStock),
    }),
    [qc, refresh],
  );
}
