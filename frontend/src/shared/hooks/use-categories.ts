import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Category, CategoryIcon } from "@/entities/types";
import { api } from "@/shared/api/client";
import { useInvalidate } from "@/shared/hooks/use-invalidate";
import { toastApiError } from "@/shared/lib/api-toast";
import { queryKeys } from "@/shared/lib/query-keys";

/** 完整类别列表（管理页）；筛选下拉请用 light */
export function useCategoriesQuery(opts?: { light?: boolean }) {
  const light = !!opts?.light;
  return useQuery({
    queryKey: light
      ? ([...queryKeys.categories, "light"] as const)
      : queryKeys.categories,
    queryFn: () => api.listCategories(light ? { light: true } : undefined),
    staleTime: light ? 60_000 : 45_000,
  });
}

function upsertCategory(list: Category[] | undefined, cat: Category): Category[] {
  if (!list?.length) return [cat];
  const i = list.findIndex((c) => c.id === cat.id);
  if (i < 0) return [cat, ...list];
  const next = list.slice();
  next[i] = { ...list[i], ...cat };
  return next;
}

export function useCreateCategory() {
  const qc = useQueryClient();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: {
      name: string;
      slug: string;
      codePrefix: string;
      description: string;
      icon: CategoryIcon;
    }) => api.createCategory(input),
    onSuccess: (cat) => {
      // 立刻写入缓存，列表瞬间出现，不等二次请求
      qc.setQueryData<Category[]>(queryKeys.categories, (prev) =>
        upsertCategory(prev, {
          ...cat,
          cardCount: cat.cardCount ?? 0,
          unusedCount: cat.unusedCount ?? 0,
          usedCount: cat.usedCount ?? 0,
        }),
      );
      toast.success("类别已创建");
      // 后台对齐服务端 + 关联页
      void inv.categories();
    },
    onError: (e) => toastApiError(e, "创建失败"),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
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
    onSuccess: (cat) => {
      qc.setQueryData<Category[]>(queryKeys.categories, (prev) =>
        upsertCategory(prev, cat),
      );
      toast.success("已保存");
      void inv.categories();
    },
    onError: (e) => toastApiError(e, "保存失败"),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.deleteCategory(id),
    onSuccess: (_void, id) => {
      qc.setQueryData<Category[]>(queryKeys.categories, (prev) =>
        (prev ?? []).filter((c) => c.id !== id),
      );
      toast.success("类别已删除");
      void inv.categories();
    },
    onError: (e) => toastApiError(e, "删除失败"),
  });
}
