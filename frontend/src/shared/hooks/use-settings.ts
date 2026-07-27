import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Settings } from "@/entities/types";
import { api } from "@/shared/api/client";
import { useInvalidate } from "@/shared/hooks/use-invalidate";
import { toastApiError } from "@/shared/lib/api-toast";
import { queryKeys } from "@/shared/lib/query-keys";

export function useSettingsQuery(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api.getSettings(),
    staleTime: 60_000,
    enabled: opts?.enabled ?? true,
  });
}

export function useUpdateSettings() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api.updateSettings(patch),
    onSuccess: (data) => {
      toast.success("已保存");
      inv.settings();
      // 立刻把 favicon/标题刷到标签栏，不等 public config 回流
      void import("@/shared/lib/document-meta").then(({ applyDocumentMeta }) => {
        applyDocumentMeta({
          documentTitle: data.documentTitle,
          siteName: data.siteName,
          siteFavicon: data.siteFavicon || null,
          faviconVersion: data.siteFavicon || String(Date.now()),
        });
      });
      return data;
    },
    onError: (e) => toastApiError(e, "保存失败"),
  });
}

export function useSetPublicRedeemKey() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: { mode: "rotate" | "custom"; customKey?: string }) =>
      api.setPublicRedeemApiKey(input),
    onSuccess: (data) => {
      toast.success("密钥已更新");
      inv.apiKeys();
      return data;
    },
    onError: (e) => toastApiError(e, "更新失败"),
  });
}
