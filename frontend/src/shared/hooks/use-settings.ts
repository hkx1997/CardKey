import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
    staleTime: 30_000,
    enabled: opts?.enabled ?? true,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api.updateSettings(patch),
    onSuccess: (data) => {
      // 表单页立刻用返回值
      qc.setQueryData(queryKeys.settings, data);
      toast.success("已保存");
      void import("@/shared/lib/document-meta").then(({ applyDocumentMeta }) => {
        applyDocumentMeta({
          documentTitle: data.documentTitle,
          siteName: data.siteName,
          siteFavicon: data.siteFavicon || null,
          faviconVersion: data.siteFavicon || String(Date.now()),
        });
      });
      void inv.settings();
    },
    onError: (e) => toastApiError(e, "保存失败"),
  });
}

export function useSetPublicRedeemKey() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: { mode: "rotate" | "custom"; customKey?: string }) =>
      api.setPublicRedeemApiKey(input),
    onSuccess: () => {
      toast.success("密钥已更新");
      void inv.apiKeys();
      void inv.settings();
    },
    onError: (e) => toastApiError(e, "更新失败"),
  });
}

export function useTestMail() {
  return useMutation({
    mutationFn: (to?: string) => api.testMail(to),
    onSuccess: (data) => {
      toast.success(data.message || "测试成功");
    },
    onError: (e) => toastApiError(e, "邮件测试失败"),
  });
}
