import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/shared/api/client";
import { toastApiError } from "@/shared/lib/api-toast";
import { queryKeys } from "@/shared/lib/query-keys";

export function useSystemInfoQuery() {
  return useQuery({
    queryKey: queryKeys.systemInfo,
    queryFn: () => api.systemInfo(),
    staleTime: 30_000,
  });
}

export function useCheckUpdates() {
  const qc = useQueryClient();
  return useMutation({
    // 手动点击始终 force，避免陈旧缓存把更旧版本标成「可更新」
    mutationFn: () => api.checkUpdates(true),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.systemInfo,
        refetchType: "active",
      });
    },
    onError: (e) => toastApiError(e, "检测失败"),
  });
}

export function useUpdateHistory(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.updateHistory,
    queryFn: () => api.updateHistory(),
    enabled,
    staleTime: 30_000,
  });
}

export function useApplyUpdate() {
  return useMutation({
    mutationFn: (version?: string) => api.applyUpdate(version),
    // 错误/成功提示与自动刷新由 SystemVersion 统一处理
    // （进程退出时 fetch 常失败，不能在这里 toast 假失败）
  });
}

export function useRollbackUpdate() {
  return useMutation({
    mutationFn: (version?: string) => api.rollbackUpdate(version),
  });
}
