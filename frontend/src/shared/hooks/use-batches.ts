import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Batch, PageResult } from "@/entities/types";
import { api } from "@/shared/api/client";
import { useInvalidate } from "@/shared/hooks/use-invalidate";
import { toastApiError } from "@/shared/lib/api-toast";
import { queryKeys } from "@/shared/lib/query-keys";

export function useBatchesQuery(params?: {
  categorySlug?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = params?.page ?? 1;
  const pageSize = params?.pageSize ?? 20;
  const categorySlug = params?.categorySlug;
  return useQuery({
    queryKey: [
      ...queryKeys.batches,
      categorySlug ?? "all",
      page,
      pageSize,
    ] as const,
    queryFn: () =>
      api.listBatches({ categorySlug, page, pageSize }),
    staleTime: 45_000,
    placeholderData: (prev) => prev,
    meta: { toastError: true },
  });
}

export function useDeleteBatch() {
  const qc = useQueryClient();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.deleteBatch(id),
    onSuccess: (_void, id) => {
      qc.setQueriesData<PageResult<Batch>>(
        { queryKey: queryKeys.batches, exact: false },
        (prev) => {
          if (!prev?.items) return prev;
          return {
            ...prev,
            items: prev.items.filter((b) => b.id !== id),
            total: Math.max(0, prev.total - 1),
          };
        },
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
