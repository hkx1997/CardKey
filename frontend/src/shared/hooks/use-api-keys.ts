import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ApiKeyMeta, ApiScope } from "@/entities/types";
import { api } from "@/shared/api/client";
import { useInvalidate } from "@/shared/hooks/use-invalidate";
import { toastApiError } from "@/shared/lib/api-toast";
import { queryKeys } from "@/shared/lib/query-keys";

export function useApiKeysQuery() {
  return useQuery({
    queryKey: queryKeys.apiKeys,
    queryFn: () => api.listApiKeys(),
    staleTime: 45_000,
    placeholderData: (prev) => prev,
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: {
      name: string;
      scopes: ApiScope[];
      rateLimitRpm?: number;
    }) => api.createApiKey(input),
    onSuccess: (res) => {
      qc.setQueryData<ApiKeyMeta[]>(queryKeys.apiKeys, (prev) =>
        prev ? [res.key, ...prev] : [res.key],
      );
      toast.success("密钥已创建");
      void inv.apiKeys();
    },
    onError: (e) => toastApiError(e, "创建失败"),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: (_void, id) => {
      const now = new Date().toISOString();
      qc.setQueryData<ApiKeyMeta[]>(queryKeys.apiKeys, (prev) =>
        (prev ?? []).map((k) =>
          k.id === id ? { ...k, revokedAt: k.revokedAt ?? now } : k,
        ),
      );
      toast.success("已吊销");
      void inv.apiKeys();
    },
    onError: (e) => toastApiError(e, "吊销失败"),
  });
}

export function useDeleteApiKey() {
  const qc = useQueryClient();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.deleteApiKey(id),
    onSuccess: (_void, id) => {
      qc.setQueryData<ApiKeyMeta[]>(queryKeys.apiKeys, (prev) =>
        (prev ?? []).filter((k) => k.id !== id),
      );
      toast.success("密钥已删除");
      void inv.apiKeys();
    },
    onError: (e) => toastApiError(e, "删除失败"),
  });
}

export function useRotateApiKey() {
  const qc = useQueryClient();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.rotateApiKey(id),
    onSuccess: (res) => {
      qc.setQueryData<ApiKeyMeta[]>(queryKeys.apiKeys, (prev) =>
        (prev ?? []).map((k) => (k.id === res.key.id ? res.key : k)),
      );
      toast.success("已轮换，请复制新密钥");
      void inv.apiKeys();
    },
    onError: (e) => toastApiError(e, "轮换失败"),
  });
}
