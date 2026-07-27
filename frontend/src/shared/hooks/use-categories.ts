import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import type { CategoryIcon } from "@/entities/types";
import { api } from "@/shared/api/client";
import { useInvalidate } from "@/shared/hooks/use-invalidate";
import { toastApiError } from "@/shared/lib/api-toast";
import { queryKeys } from "@/shared/lib/query-keys";

export function useCategoriesQuery() {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => api.listCategories(),
  });
}

export function useCreateCategory() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: {
      name: string;
      slug: string;
      codePrefix: string;
      description: string;
      icon: CategoryIcon;
    }) => api.createCategory(input),
    onSuccess: () => {
      toast.success("类别已创建");
      inv.categories();
    },
    onError: (e) => toastApiError(e, "创建失败"),
  });
}

export function useUpdateCategory() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: {
      id: string;
      name?: string;
      description?: string;
      icon?: CategoryIcon;
      enabled?: boolean;
    }) => api.updateCategory(id, patch),
    onSuccess: () => {
      toast.success("已保存");
      inv.categories();
    },
    onError: (e) => toastApiError(e, "保存失败"),
  });
}

export function useDeleteCategory() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.deleteCategory(id),
    onSuccess: () => {
      toast.success("类别已删除");
      inv.categories();
      inv.cards();
      inv.batches();
    },
    onError: (e) => toastApiError(e, "删除失败"),
  });
}
