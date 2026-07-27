import { useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/shared/api/client";
import { toastApiError } from "@/shared/lib/api-toast";
import { queryKeys } from "@/shared/lib/query-keys";

export function useSystemInfoQuery() {
  return useQuery({
    queryKey: queryKeys.systemInfo,
    queryFn: () => api.systemInfo(),
    staleTime: 60_000,
  });
}

export function useCheckUpdates() {
  return useMutation({
    mutationFn: () => api.checkUpdates(),
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
    onError: (e) => toastApiError(e, "更新失败"),
  });
}

export function useRollbackUpdate() {
  return useMutation({
    mutationFn: (version?: string) => api.rollbackUpdate(version),
    onError: (e) => toastApiError(e, "回滚失败"),
  });
}
