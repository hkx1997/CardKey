import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ApiScope } from "@/entities/types";
import { api } from "@/shared/api/client";
import { useInvalidate } from "@/shared/hooks/use-invalidate";
import { toastApiError } from "@/shared/lib/api-toast";
import { queryKeys } from "@/shared/lib/query-keys";

export function useApiKeysQuery() {
  return useQuery({
    queryKey: queryKeys.apiKeys,
    queryFn: () => api.listApiKeys(),
  });
}

export function useCreateApiKey() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: {
      name: string;
      scopes: ApiScope[];
      rateLimitRpm?: number;
    }) => api.createApiKey(input),
    onSuccess: async () => {
      toast.success("密钥已创建");
      await inv.apiKeys();
    },
    onError: (e) => toastApiError(e, "创建失败"),
  });
}

export function useRevokeApiKey() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: async () => {
      toast.success("已吊销");
      await inv.apiKeys();
    },
    onError: (e) => toastApiError(e, "吊销失败"),
  });
}

export function useDeleteApiKey() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.deleteApiKey(id),
    onSuccess: async () => {
      toast.success("密钥已删除");
      await inv.apiKeys();
    },
    onError: (e) => toastApiError(e, "删除失败"),
  });
}

export function useRotateApiKey() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.rotateApiKey(id),
    onSuccess: async () => {
      toast.success("已轮换，请复制新密钥");
      await inv.apiKeys();
    },
    onError: (e) => toastApiError(e, "轮换失败"),
  });
}
