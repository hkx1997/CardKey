import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/shared/api/client";
import { useInvalidate } from "@/shared/hooks/use-invalidate";
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
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.systemInfo });
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
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (version?: string) => api.applyUpdate(version),
    onSuccess: async () => {
      toast.message("更新已提交，服务即将重启…");
      await inv.system();
    },
    onError: (e) => toastApiError(e, "更新失败"),
  });
}

export function useRollbackUpdate() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (version?: string) => api.rollbackUpdate(version),
    onSuccess: async () => {
      toast.message("回滚已提交，服务即将重启…");
      await inv.system();
    },
    onError: (e) => toastApiError(e, "回滚失败"),
  });
}
