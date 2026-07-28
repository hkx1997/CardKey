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
        // 较短 stale，配合 invalidate+refetch 保证增删改后列表即时更新
        staleTime: 5_000,
        retry: 1,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
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
