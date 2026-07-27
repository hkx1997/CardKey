import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

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
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.deleteBatch(id),
    onSuccess: () => {
      toast.success("批次已删除");
      inv.batches();
    },
    onError: (e) => toastApiError(e, "删除失败"),
  });
}
