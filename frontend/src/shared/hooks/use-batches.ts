import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Batch } from "@/entities/types";
import { api } from "@/shared/api/client";
import { useInvalidate } from "@/shared/hooks/use-invalidate";
import { toastApiError } from "@/shared/lib/api-toast";
import { queryKeys } from "@/shared/lib/query-keys";

export function useBatchesQuery(categorySlug?: string) {
  return useQuery({
    queryKey: [...queryKeys.batches, categorySlug ?? "all"],
    queryFn: () => api.listBatches(categorySlug),
  });
}

export function useDeleteBatch() {
  const qc = useQueryClient();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.deleteBatch(id),
    onSuccess: (_void, id) => {
      // 立刻从所有批次列表缓存移除
      qc.setQueriesData<Batch[]>(
        { queryKey: queryKeys.batches, exact: false },
        (prev) => (prev ?? []).filter((b) => b.id !== id),
      );
      toast.success("批次已删除");
      void inv.batches();
    },
    onError: (e) => toastApiError(e, "删除失败"),
  });
}

export function useExportBatch() {
  return useMutation({
    mutationFn: (id: string) => api.exportBatch(id),
    onError: (e) => toastApiError(e, "导出失败"),
  });
}
