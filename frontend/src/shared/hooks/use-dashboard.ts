import { useQuery } from "@tanstack/react-query";

import { api } from "@/shared/api/client";
import { useDocumentVisible } from "@/shared/hooks/use-visible";
import { queryKeys } from "@/shared/lib/query-keys";

export function useDashboardQuery(categorySlug?: string) {
  return useQuery({
    queryKey: [...queryKeys.dashboard, categorySlug ?? "all"] as const,
    queryFn: () => api.dashboardStats(categorySlug),
    staleTime: 45_000,
    refetchOnWindowFocus: false,
    meta: { toastError: true },
  });
}

/** 运行时流量 / 并发 / 延迟；仅页面可见时 5s 轮询 */
export function useRuntimeMetricsQuery(enabled = true) {
  const visible = useDocumentVisible();
  return useQuery({
    queryKey: queryKeys.runtimeMetrics,
    queryFn: () => api.runtimeMetrics(),
    enabled: enabled && visible,
    refetchInterval: visible ? 5_000 : false,
    staleTime: 2_000,
    refetchIntervalInBackground: false,
  });
}
