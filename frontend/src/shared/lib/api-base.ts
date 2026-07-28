import type { PublicConfig } from "@/entities/types";

/**
 * 解析文档 / 设置页中的 API 地址。
 *
 * - baseRoot：仅 origin（文档 Base URL，不含 /api/v1）
 * - apiPrefix：路径前缀（默认 /api/v1），已写在各接口 path 上
 * - redeemUrl：完整兑换 URL = baseRoot + apiPrefix + /public/redeem
 *
 * 若 apiPublicBaseUrl 误写成带路径（如 https://x.com/api/v1），仍会拆成
 * baseRoot=origin、apiPrefix=pathname，避免文档里 Base 与 path 重复拼接。
 */
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
      // Base URL 文档只展示 origin；pathname 若存在则当作前缀覆盖 apiBasePath
      baseRoot = `${u.protocol}//${u.host}`;
      if (u.pathname && u.pathname !== "/") {
        apiPrefix = u.pathname.replace(/\/$/, "") || path;
      } else {
        apiPrefix = path;
      }
    } catch {
      // 非 URL 时按纯 host/origin 字符串处理
      baseRoot = configured;
      apiPrefix = path;
    }
  }
  const redeemUrl = `${baseRoot}${apiPrefix}/public/redeem`;
  return { baseRoot, apiPrefix, redeemUrl };
}
