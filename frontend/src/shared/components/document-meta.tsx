import { useEffect } from "react";

import { applyDocumentMeta } from "@/shared/lib/document-meta";
import { usePublicConfigQuery } from "@/shared/hooks/use-public-config";

/**
 * 全局应用站点标题与 Favicon（兑换页 / 管理端 / 文档页均生效）。
 * 依赖公开配置；保存系统设置后会 invalidate publicConfig。
 */
export function DocumentMeta() {
  const { data: cfg } = usePublicConfigQuery();

  useEffect(() => {
    const fav = cfg?.siteFavicon ?? null;
    // 用 fav 路径本身做版本键（上传文件名含时间戳，改 URL 即刷新）
    applyDocumentMeta({
      documentTitle: cfg?.documentTitle,
      siteName: cfg?.siteName,
      siteFavicon: fav,
      faviconVersion: fav || "default",
    });
  }, [cfg?.documentTitle, cfg?.siteName, cfg?.siteFavicon]);

  return null;
}
