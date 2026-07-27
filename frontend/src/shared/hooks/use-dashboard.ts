import { useQuery } from "@tanstack/react-query";

import { api } from "@/shared/api/client";
import { queryKeys } from "@/shared/lib/query-keys";

export function useDashboardQuery(categorySlug?: string) {
  return useQuery({
    queryKey: [...queryKeys.dashboard, categorySlug ?? "all"] as const,
    queryFn: () => api.dashboardStats(categorySlug),
  });
}

/** 运行时流量 / 并发 / 延迟，短轮询 */
export function useRuntimeMetricsQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.runtimeMetrics,
    queryFn: () => api.runtimeMetrics(),
    enabled,
    refetchInterval: 5_000,
    staleTime: 2_000,
  });
}
