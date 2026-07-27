import type { PublicConfig } from "@/entities/types";

/** 解析文档 / 设置页中展示的 API 根地址与完整 redeem URL */
export function resolveApiBase(
  cfg?: Pick<PublicConfig, "apiBasePath" | "apiPublicBaseUrl"> | null,
) {
  const path = (cfg?.apiBasePath || "/api/v1").replace(/\/$/, "") || "/api/v1";
  const configured = (cfg?.apiPublicBaseUrl || "").replace(/\/$/, "");
  const origin =
    configured ||
    (typeof window !== "undefined" ? window.location.origin : "https://host");
  let baseRoot = origin;
  let apiPrefix = path;
  if (configured) {
    try {
      const u = new URL(configured);
      if (u.pathname && u.pathname !== "/") {
        baseRoot = `${u.protocol}//${u.host}`;
        apiPrefix = u.pathname.replace(/\/$/, "") || path;
      } else {
        baseRoot = configured;
        apiPrefix = path;
      }
    } catch {
      baseRoot = configured;
    }
  }
  const redeemUrl = `${baseRoot}${apiPrefix}/public/redeem`;
  return { baseRoot, apiPrefix, redeemUrl };
}
