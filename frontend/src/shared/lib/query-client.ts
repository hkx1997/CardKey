import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { toastApiError } from "@/shared/lib/api-toast";

/**
 * 统一 QueryClient：
 * - mutation 无业务 onError 时全局 toast
 * - query 仅 meta.toastError 时 toast（避免列表页重复提示）
 */
export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.meta?.toastError) {
          toastApiError(error, "加载失败");
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        // 业务已写 onError 时由业务 toast，避免双弹
        if (mutation.options.onError) return;
        toastApiError(error);
      },
    }),
  });
}
