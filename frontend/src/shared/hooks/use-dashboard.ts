import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import type { DashboardTrendRange } from "@/entities/types";
import { api } from "@/shared/api/client";
import { useDocumentVisible } from "@/shared/hooks/use-visible";
import { queryKeys } from "@/shared/lib/query-keys";

export function useDashboardQuery(categorySlug?: string) {
  return useQuery({
    queryKey: [...queryKeys.dashboard, categorySlug ?? "all"] as const,
    queryFn: () => api.dashboardStats(categorySlug),
    staleTime: 25_000, // 后端另有进程缓存
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
    meta: { toastError: true },
  });
}

/** 兑换趋势：today / 24h / 7d / 14d / 30d */
export function useDashboardTrendQuery(range: DashboardTrendRange | string) {
  return useQuery({
    queryKey: queryKeys.dashboardTrend(range),
    queryFn: () => api.dashboardTrend(range),
    staleTime: 20_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
    meta: { toastError: true },
  });
}

/** 运行时流量 / 并发 / 延迟 */
export function useRuntimeMetricsQuery(enabled = true) {
  const visible = useDocumentVisible();
  return useQuery({
    queryKey: queryKeys.runtimeMetrics,
    queryFn: () => api.runtimeMetrics(),
    enabled: enabled && visible,
    staleTime: 10_000,
    refetchInterval: visible ? 15_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

/** 仪表盘全局刷新（统计 + 趋势 + 运行时） */
export function useDashboardRefresh(trendRange: string) {
  const qc = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.dashboard }),
      qc.invalidateQueries({ queryKey: queryKeys.dashboardTrend(trendRange) }),
      qc.invalidateQueries({ queryKey: queryKeys.runtimeMetrics }),
    ]);
  }, [qc, trendRange]);
}
