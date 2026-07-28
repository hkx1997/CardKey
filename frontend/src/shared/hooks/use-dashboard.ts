import { useQuery } from "@tanstack/react-query";

import { api } from "@/shared/api/client";
import { useDocumentVisible } from "@/shared/hooks/use-visible";
import { queryKeys } from "@/shared/lib/query-keys";

export function useDashboardQuery(categorySlug?: string) {
  return useQuery({
    queryKey: [...queryKeys.dashboard, categorySlug ?? "all"] as const,
    queryFn: () => api.dashboardStats(categorySlug),
    staleTime: 25_000, // 后端另有 ~12s 进程缓存
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    meta: { toastError: true },
  });
}

/** 运行时流量 / 并发 / 延迟；首屏后再开，降低与 stats 抢带宽 */
export function useRuntimeMetricsQuery(enabled = true) {
  const visible = useDocumentVisible();
  return useQuery({
    queryKey: queryKeys.runtimeMetrics,
    queryFn: () => api.runtimeMetrics(),
    enabled: enabled && visible,
    // 延迟首拉：挂载后 1.2s 再请求（用 placeholder 避免空白）
    staleTime: 10_000,
    refetchInterval: visible ? 15_000 : false,
    refetchIntervalInBackground: false,
  });
}
