import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import type { CardStatus, CardType } from "@/entities/types";
import { api } from "@/shared/api/client";
import { useInvalidate } from "@/shared/hooks/use-invalidate";
import { toastApiError } from "@/shared/lib/api-toast";
import { queryKeys } from "@/shared/lib/query-keys";

export function useCardsQuery(params: {
  page: number;
  pageSize: number;
  status: CardStatus | "all";
  q?: string;
  categorySlug?: string;
  batchId?: string;
}) {
  return useQuery({
    queryKey: queryKeys.cards(params),
    queryFn: () => api.listCards(params),
  });
}

export function useCardDetail(id: string | null, reveal: boolean) {
  return useQuery({
    queryKey: queryKeys.card(id ?? "", reveal),
    queryFn: () => api.getCard(id!, reveal),
    enabled: !!id,
  });
}

export function useBatchCardAction() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({
      ids,
      action,
    }: {
      ids: string[];
      action: "disable" | "enable" | "delete";
    }) => api.batchAction(ids, action),
    onSuccess: async (n, v) => {
      const label =
        v.action === "disable"
          ? "禁用"
          : v.action === "enable"
            ? "启用"
            : "删除";
      toast.success(`已${label} ${n} 条`);
      await inv.cards();
      // 详情弹窗若打开，同步刷掉
      await Promise.all(v.ids.map((id) => inv.card(id)));
    },
    onError: (e) => toastApiError(e),
  });
}

export function useCreateCard() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: {
      content: string;
      type: CardType;
      note: string;
      categoryId: string;
      contentEncoding?: string;
      filename?: string;
      mime?: string;
    }) => api.createCard(input),
    onSuccess: async () => {
      toast.success("创建成功");
      await inv.cards();
    },
    onError: (e) => toastApiError(e, "创建失败"),
  });
}

export function useImportCards() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: {
      raw: string;
      type: CardType;
      categoryId: string;
      batchName: string;
      note?: string;
    }) => api.importCards(input),
    onSuccess: async (res) => {
      toast.success(`成功导入 ${res.total} 条到「${res.category.name}」`);
      await inv.cards();
      await inv.batches();
    },
    onError: (e) => toastApiError(e, "导入失败"),
  });
}

export function useExportCards() {
  return useMutation({
    mutationFn: (params: {
      ids?: string[];
      status?: CardStatus | "all";
      q?: string;
      categorySlug?: string;
      batchId?: string;
    }) => api.exportCards(params),
    onError: (e) => toastApiError(e, "导出失败"),
  });
}
