import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Card, CardStatus, CardType, PageResult } from "@/entities/types";
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
    placeholderData: (prev) => prev,
    meta: { toastError: true },
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
    onSuccess: (n, v) => {
      const label =
        v.action === "disable"
          ? "禁用"
          : v.action === "enable"
            ? "启用"
            : "删除";
      toast.success(`已${label} ${n} 条`);
      // 列表为主，详情后台 bump
      void inv.cards();
      for (const id of v.ids) inv.card(id);
    },
    onError: (e) => toastApiError(e),
  });
}

export function useCreateCard() {
  const qc = useQueryClient();
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
    onSuccess: (card) => {
      // 当前打开的卡密列表：插到第一页缓存（若有）
      qc.setQueriesData<PageResult<Card>>(
        { queryKey: queryKeys.cards(), exact: false },
        (prev) => {
          if (!prev?.items) return prev;
          // 仅在第 1 页插入，避免分页错乱
          if (prev.page !== 1) {
            return { ...prev, total: prev.total + 1 };
          }
          return {
            ...prev,
            total: prev.total + 1,
            items: [card, ...prev.items].slice(0, prev.pageSize),
          };
        },
      );
      toast.success("创建成功");
      void inv.cards();
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
    onSuccess: (res) => {
      toast.success(`成功导入 ${res.total} 条到「${res.category.name}」`);
      void inv.cards();
      void inv.batches();
    },
    onError: (e) => toastApiError(e, "导入失败"),
  });
}

export function useExportCards() {
  return useMutation({
    mutationFn: (input: {
      params: {
        ids?: string[];
        status?: CardStatus | "all";
        q?: string;
        categorySlug?: string;
        batchId?: string;
      };
      onProgress?: (done: number, total: number) => void;
    }) => api.exportCards(input.params, { onProgress: input.onProgress }),
    onError: (e) => toastApiError(e, "导出失败"),
  });
}
