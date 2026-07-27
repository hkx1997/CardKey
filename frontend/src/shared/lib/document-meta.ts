/** 浏览器标签标题与 Favicon 工具（全局复用） */

const FAVICON_IDS = {
  icon: "cardkey-favicon",
  shortcut: "cardkey-favicon-shortcut",
  apple: "cardkey-apple-touch",
} as const;

const DEFAULT_FAVICON = "/favicon.svg";

export function resolveDocumentTitle(
  documentTitle?: string | null,
  siteName?: string | null,
) {
  const t = (documentTitle || "").trim();
  if (t) return t;
  const n = (siteName || "").trim();
  return n || "CardKey";
}

function guessFaviconType(href: string): string | undefined {
  const base = href.split("?")[0]?.split("#")[0] ?? href;
  const lower = base.toLowerCase();
  if (lower.startsWith("data:")) {
    const m = /^data:([^;,]+)/i.exec(href);
    return m?.[1];
  }
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".ico")) return "image/x-icon";
  return undefined;
}

/** 相对路径保持同源；外链原样 */
export function normalizeAssetHref(href: string): string {
  const h = href.trim();
  if (!h) return DEFAULT_FAVICON;
  if (
    h.startsWith("data:") ||
    h.startsWith("blob:") ||
    /^https?:\/\//i.test(h) ||
    h.startsWith("//")
  ) {
    return h;
  }
  if (h.startsWith("/")) return h;
  return `/${h}`;
}

function upsertLink(id: string, rel: string, href: string, type?: string) {
  let link = document.getElementById(id) as HTMLLinkElement | null;
  if (!link) {
    // 复用页面里已有的同 rel（index.html 默认 icon）
    if (rel === "icon") {
      const existing = document.querySelector<HTMLLinkElement>(
        "link[rel='icon']:not([id])",
      );
      if (existing) {
        link = existing;
        link.id = id;
      }
    }
  }
  if (!link) {
    link = document.createElement("link");
    link.id = id;
    document.head.appendChild(link);
  }
  link.rel = rel;
  if (type) {
    link.type = type;
  } else {
    link.removeAttribute("type");
  }
  // 浏览器对 favicon 缓存极强：同 URL 可能不刷新；先清空再赋值
  if (link.getAttribute("href") === href) {
    link.removeAttribute("href");
  }
  link.href = href;
}

/**
 * 应用标签图标。href 为空时回退默认 /favicon.svg。
 * cacheKey 用于强制刷新（如上传文件名里的时间戳）。
 */
export function applyFavicon(href?: string | null, cacheKey?: string | null) {
  if (typeof document === "undefined") return;
  let url = normalizeAssetHref(href || DEFAULT_FAVICON);
  if (cacheKey && !url.startsWith("data:") && !url.includes("?")) {
    url = `${url}?v=${encodeURIComponent(cacheKey)}`;
  } else if (cacheKey && url.includes("?") && !url.startsWith("data:")) {
    url = `${url}&v=${encodeURIComponent(cacheKey)}`;
  }
  const type = guessFaviconType(url);
  upsertLink(FAVICON_IDS.icon, "icon", url, type);
  upsertLink(FAVICON_IDS.shortcut, "shortcut icon", url, type);
  upsertLink(FAVICON_IDS.apple, "apple-touch-icon", url, type);
}

export function applyDocumentMeta(opts: {
  documentTitle?: string | null;
  siteName?: string | null;
  siteFavicon?: string | null;
  /** 变化时强制刷 favicon 缓存，如 updatedAt / 文件名 */
  faviconVersion?: string | null;
}) {
  if (typeof document === "undefined") return;
  document.title = resolveDocumentTitle(opts.documentTitle, opts.siteName);
  applyFavicon(opts.siteFavicon, opts.faviconVersion);
}
