import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";

hljs.registerLanguage("json", json);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("go", go);
hljs.registerLanguage("golang", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("php", php);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("curl", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("text", plaintext);
hljs.registerLanguage("codes", plaintext);

/** 展示名 / 别名 → highlight.js 语言 id */
const LANG_MAP: Record<string, string> = {
  json: "json",
  javascript: "javascript",
  js: "javascript",
  python: "python",
  py: "python",
  go: "go",
  golang: "go",
  java: "java",
  php: "php",
  curl: "bash",
  bash: "bash",
  shell: "bash",
  sh: "bash",
  codes: "plaintext",
  text: "plaintext",
  plaintext: "plaintext",
  code: "plaintext",
};

export function resolveHighlightLang(lang?: string): string {
  if (!lang) return "plaintext";
  const key = lang.trim().toLowerCase();
  // "JavaScript" / "cURL" 等展示名也能匹配
  if (LANG_MAP[key]) return LANG_MAP[key];
  if (key === "c++" || key === "cpp") return "plaintext";
  return hljs.getLanguage(key) ? key : "plaintext";
}

/** Tab → 2 空格，统一缩进视觉 */
function normalizeIndent(code: string): string {
  return code.replace(/\t/g, "  ").replace(/\r\n/g, "\n");
}

/** 返回安全的高亮 HTML（hljs 会转义，保留空白） */
export function highlightCode(code: string, lang?: string): string {
  const source = normalizeIndent(code);
  const language = resolveHighlightLang(lang);
  try {
    if (language === "plaintext" || !hljs.getLanguage(language)) {
      return hljs.highlight(source, { language: "plaintext" }).value;
    }
    return hljs.highlight(source, { language }).value;
  } catch {
    // 高亮失败时仍转义文本，避免 XSS，并保留换行缩进
    return source
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
