import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ApiError } from "@/entities/types";
import { api } from "@/shared/api/client";
import { getErrorMessage } from "@/shared/lib/api-toast";
import type { BatchRedeemItem } from "@/shared/lib/redeem-zip";
import { queryKeys } from "@/shared/lib/query-keys";

/** 站点配置（含类别元数据）；库存另由 stock 轮询刷新 */
export function usePublicConfigQuery() {
  return useQuery({
    queryKey: queryKeys.publicConfig,
    queryFn: () => api.getPublicConfig(),
    staleTime: 60_000,
  });
}

/** 兑换端类别库存默认轮询间隔（毫秒） */
export const PUBLIC_STOCK_POLL_MS = 10_000;

/** 兑换端类别库存：默认 10s 轮询，窗口聚焦时也会刷新 */
export function usePublicCategoryStockQuery(opts?: {
  /** 轮询间隔 ms，默认 10000；0 关闭轮询 */
  intervalMs?: number;
  enabled?: boolean;
}) {
  const interval =
    opts?.intervalMs === undefined ? PUBLIC_STOCK_POLL_MS : opts.intervalMs;
  return useQuery({
    queryKey: queryKeys.publicCategoryStock,
    queryFn: () => api.getPublicCategoryStock(),
    enabled: opts?.enabled !== false,
    staleTime: Math.min(5_000, Math.max(0, interval)),
    refetchInterval: interval > 0 ? interval : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useRedeemMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { category: string; code: string }) =>
      api.redeem(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.publicCategoryStock });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof ApiError ? e.message : "兑换失败");
    },
  });
}

/**
 * 批量兑换：逐条调用公开 redeem API（顺序执行，避免瞬时打爆限流）。
 * 单条失败不中断整批，结果写入 items。
 */
export function useBatchRedeemMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      category: string;
      codes: string[];
      onProgress?: (done: number, total: number, last: BatchRedeemItem) => void;
    }): Promise<BatchRedeemItem[]> => {
      const { category, codes, onProgress } = input;
      const items: BatchRedeemItem[] = [];
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i]!;
        let item: BatchRedeemItem;
        try {
          const result = await api.redeem({ category, code });
          item = { code, ok: true, result };
        } catch (e) {
          item = {
            code,
            ok: false,
            error: getErrorMessage(e, "兑换失败"),
          };
        }
        items.push(item);
        onProgress?.(i + 1, codes.length, item);
      }
      return items;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.publicCategoryStock });
    },
  });
}
