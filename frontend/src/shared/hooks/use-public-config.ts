import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { ApiError } from "@/entities/types";
import { api } from "@/shared/api/client";
import { getErrorMessage } from "@/shared/lib/api-toast";
import type { BatchRedeemItem } from "@/shared/lib/redeem-zip";
import { queryKeys } from "@/shared/lib/query-keys";

export function usePublicConfigQuery() {
  return useQuery({
    queryKey: queryKeys.publicConfig,
    queryFn: () => api.getPublicConfig(),
    staleTime: 30_000,
  });
}

export function useRedeemMutation() {
  return useMutation({
    mutationFn: (input: { category: string; code: string }) =>
      api.redeem(input),
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
  });
}
