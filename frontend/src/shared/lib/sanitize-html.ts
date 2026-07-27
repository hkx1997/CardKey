/** 简易 HTML 消毒：去掉脚本与事件，保留常见排版标签 */
const ALLOWED = new Set([
  "P",
  "BR",
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "S",
  "UL",
  "OL",
  "LI",
  "A",
  "H1",
  "H2",
  "H3",
  "SPAN",
  "DIV",
  "BLOCKQUOTE",
  "CODE",
  "PRE",
]);

export function sanitizeHtml(html: string): string {
  if (!html?.trim()) return "";
  if (typeof DOMParser === "undefined") {
    return html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (node: Node) => {
    const children = [...node.childNodes];
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (!ALLOWED.has(el.tagName)) {
          // 保留文本，去掉标签
          while (el.firstChild) {
            node.insertBefore(el.firstChild, el);
          }
          node.removeChild(el);
          continue;
        }
        // 清属性
        for (const attr of [...el.attributes]) {
          const n = attr.name.toLowerCase();
          if (n.startsWith("on") || n === "style") {
            el.removeAttribute(attr.name);
          } else if (el.tagName === "A" && n === "href") {
            const href = el.getAttribute("href") ?? "";
            if (!/^(https?:|mailto:|\/|#)/i.test(href)) {
              el.removeAttribute("href");
            } else {
              el.setAttribute("target", "_blank");
              el.setAttribute("rel", "noopener noreferrer");
            }
          } else if (n !== "href") {
            el.removeAttribute(attr.name);
          }
        }
        walk(el);
      }
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

export function isEmptyHtml(html: string): boolean {
  const t = html
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
  return !t;
}
