import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { queryKeys } from "@/shared/lib/query-keys";

/** 统一失效常用查询，页面 mutation 不再手写字符串 */
export function useInvalidate() {
  const qc = useQueryClient();

  const all = useCallback(
    (...keys: readonly (readonly unknown[])[]) => {
      for (const key of keys) {
        void qc.invalidateQueries({ queryKey: [...key] });
      }
    },
    [qc],
  );

  return {
    qc,
    all,
    categories: () => all(queryKeys.categories, queryKeys.publicConfig, queryKeys.dashboard),
    cards: () =>
      all(queryKeys.cards(), queryKeys.dashboard, queryKeys.categories, queryKeys.batches),
    batches: () => all(queryKeys.batches, queryKeys.cards(), queryKeys.dashboard),
    settings: () =>
      all(queryKeys.settings, queryKeys.publicConfig, queryKeys.apiKeys),
    apiKeys: () =>
      all(queryKeys.apiKeys, queryKeys.dashboard, queryKeys.settings, queryKeys.publicConfig),
    dashboard: () => all(queryKeys.dashboard),
    redeems: () => all(queryKeys.redeems(), queryKeys.dashboard),
  };
}
