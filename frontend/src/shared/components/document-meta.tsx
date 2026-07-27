import { useEffect } from "react";

import { useAuth } from "@/shared/auth/auth-context";
import { applyDocumentMeta } from "@/shared/lib/document-meta";
import { usePublicConfigQuery } from "@/shared/hooks/use-public-config";
import { useSettingsQuery } from "@/shared/hooks/use-settings";

/**
 * 全局应用站点标题与 Favicon。
 * - 公开页：public/config.siteFavicon
 * - 管理端：优先 settings（保存后立即可用），否则回退 public config
 */
export function DocumentMeta() {
  const { user } = useAuth();
  const pubQ = usePublicConfigQuery();
  const settingsQ = useSettingsQuery({ enabled: !!user });

  useEffect(() => {
    const settingsFav = (settingsQ.data?.siteFavicon || "").trim();
    const publicFav = (
      pubQ.data?.siteFavicon == null ? "" : String(pubQ.data.siteFavicon)
    ).trim();

    // 管理端有 settings 时优先（含刚上传未刷 public 的瞬间）
    const fav =
      user && settingsFav
        ? settingsFav
        : publicFav || settingsFav || null;

    const documentTitle =
      (user && settingsQ.data?.documentTitle) ||
      pubQ.data?.documentTitle ||
      settingsQ.data?.documentTitle;

    const siteName =
      (user && settingsQ.data?.siteName) ||
      pubQ.data?.siteName ||
      settingsQ.data?.siteName;

    applyDocumentMeta({
      documentTitle,
      siteName,
      siteFavicon: fav,
      faviconVersion: fav || "default",
    });
  }, [
    user,
    pubQ.data?.siteFavicon,
    pubQ.data?.documentTitle,
    pubQ.data?.siteName,
    settingsQ.data?.siteFavicon,
    settingsQ.data?.documentTitle,
    settingsQ.data?.siteName,
  ]);

  return null;
}
