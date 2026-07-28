import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ApiError } from "@/entities/types";
import { api } from "@/shared/api/client";
import { useDocumentVisible } from "@/shared/hooks/use-visible";
import { getErrorMessage } from "@/shared/lib/api-toast";
import type { BatchRedeemItem } from "@/shared/lib/redeem-zip";
import { queryKeys } from "@/shared/lib/query-keys";

/** 站点配置（含类别元数据）；库存另由 stock 轮询刷新 */
export function usePublicConfigQuery(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.publicConfig,
    queryFn: () => api.getPublicConfig(),
    staleTime: 90_000,
    enabled: opts?.enabled ?? true,
  });
}

/** 兑换端类别库存默认轮询间隔（毫秒） */
export const PUBLIC_STOCK_POLL_MS = 15_000;

/** 兑换端类别库存：默认 10s 轮询；页面不可见时暂停 */
export function usePublicCategoryStockQuery(opts?: {
  /** 轮询间隔 ms，默认 10000；0 关闭轮询 */
  intervalMs?: number;
  enabled?: boolean;
}) {
  const visible = useDocumentVisible();
  const interval =
    opts?.intervalMs === undefined ? PUBLIC_STOCK_POLL_MS : opts.intervalMs;
  const enabled = opts?.enabled !== false && visible;
  return useQuery({
    queryKey: queryKeys.publicCategoryStock,
    queryFn: () => api.getPublicCategoryStock(),
    enabled,
    staleTime: Math.min(12_000, Math.max(0, interval)),
    refetchInterval: enabled && interval > 0 ? interval : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });
}

export function useRedeemMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      category: string;
      code: string;
      captchaToken?: string;
    }) => api.redeem(input),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.publicCategoryStock,
        refetchType: "active",
      });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof ApiError ? e.message : "兑换失败");
    },
  });
}

/** 批量兑换单次上限（防无限粘贴打爆限流） */
export const BATCH_REDEEM_MAX = 50;

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
      captchaToken?: string;
      onProgress?: (done: number, total: number, last: BatchRedeemItem) => void;
    }): Promise<BatchRedeemItem[]> => {
      const { category, onProgress, captchaToken } = input;
      let codes = input.codes;
      if (codes.length > BATCH_REDEEM_MAX) {
        toast.message(
          `单次最多兑换 ${BATCH_REDEEM_MAX} 条，已截取前 ${BATCH_REDEEM_MAX} 条`,
        );
        codes = codes.slice(0, BATCH_REDEEM_MAX);
      }
      const items: BatchRedeemItem[] = [];
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i]!;
        let item: BatchRedeemItem;
        try {
          // 首条带 Turnstile token；服务端校验后 Redis 短时放行同 IP 后续条
          const result = await api.redeem({
            category,
            code,
            captchaToken: i === 0 ? captchaToken : undefined,
          });
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
      void qc.invalidateQueries({
        queryKey: queryKeys.publicCategoryStock,
        refetchType: "active",
      });
    },
  });
}
