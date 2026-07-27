/** 浏览器标签标题与 Favicon 工具（全局复用） */

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

/**
 * 将相对资源路径转为绝对 URL（同源）。
 * 浏览器对 favicon 有时对相对路径更新不敏感，绝对地址更稳。
 */
export function toAbsoluteAssetUrl(href: string): string {
  const h = href.trim();
  if (!h) return h;
  if (
    h.startsWith("data:") ||
    h.startsWith("blob:") ||
    /^https?:\/\//i.test(h) ||
    h.startsWith("//")
  ) {
    return h;
  }
  if (typeof window === "undefined") {
    return h.startsWith("/") ? h : `/${h}`;
  }
  try {
    return new URL(h.startsWith("/") ? h : `/${h}`, window.location.origin)
      .href;
  } catch {
    return h;
  }
}

/** 相对路径保持可用；外链原样 */
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

function removeAllFaviconLinks() {
  if (typeof document === "undefined") return;
  document
    .querySelectorAll(
      'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]',
    )
    .forEach((el) => el.remove());
}

function appendIconLink(rel: string, href: string, type?: string) {
  const link = document.createElement("link");
  link.rel = rel;
  if (type) link.type = type;
  // sizes=any 让现代浏览器接受 png/svg 作为主图标
  if (rel === "icon") {
    link.setAttribute("sizes", "any");
  }
  link.href = href;
  document.head.appendChild(link);
}

/**
 * 应用标签图标。href 为空时回退默认 /favicon.svg。
 * 会先移除 head 内所有旧 icon 链接，避免 index.html 默认图标抢占。
 */
export function applyFavicon(href?: string | null, cacheKey?: string | null) {
  if (typeof document === "undefined") return;

  const raw = (href || "").trim();
  let path = normalizeAssetHref(raw || DEFAULT_FAVICON);

  // cache bust：路径已含查询则追加 &v=
  const ver =
    (cacheKey && String(cacheKey).trim()) ||
    (raw ? raw : "default");
  if (!path.startsWith("data:") && !path.startsWith("blob:")) {
    const sep = path.includes("?") ? "&" : "?";
    // 用短 hash，避免把整个 data URL 塞进 query
    const v =
      ver.length > 64
        ? String(ver.length) + ver.slice(0, 16)
        : ver;
    path = `${path}${sep}v=${encodeURIComponent(v)}`;
  }

  const abs = path.startsWith("data:") || path.startsWith("blob:")
    ? path
    : toAbsoluteAssetUrl(path);
  const type = guessFaviconType(raw || path);

  removeAllFaviconLinks();
  appendIconLink("icon", abs, type);
  appendIconLink("shortcut icon", abs, type);
  appendIconLink("apple-touch-icon", abs, type);
}

export function applyDocumentMeta(opts: {
  documentTitle?: string | null;
  siteName?: string | null;
  siteFavicon?: string | null;
  /** 变化时强制刷 favicon 缓存 */
  faviconVersion?: string | null;
}) {
  if (typeof document === "undefined") return;
  document.title = resolveDocumentTitle(opts.documentTitle, opts.siteName);
  applyFavicon(opts.siteFavicon, opts.faviconVersion ?? opts.siteFavicon);
}
