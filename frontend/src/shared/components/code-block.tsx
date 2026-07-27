import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { cn } from "@/shared/lib/cn";
import { highlightCode } from "@/shared/lib/highlight";

/**
 * 统一代码块：顶栏 + 固定高度 + 语法高亮。
 * 内容少也占满固定高度，内容多区内滚动。
 */
export function CodeBlock({
  code,
  lang,
  className,
  /** 内容区固定高度（h-*，不是 max-h-*） */
  heightClass = "h-64",
  maxHeightClass,
}: {
  code: string;
  /** 语言：json / JavaScript / Python / Go / curl 等 */
  lang?: string;
  className?: string;
  heightClass?: string;
  /** @deprecated 请改用 heightClass */
  maxHeightClass?: string;
}) {
  const [done, setDone] = useState(false);
  const resolvedHeight =
    heightClass !== "h-64"
      ? heightClass
      : maxHeightClass
        ? maxHeightClass.replace(/^max-h-/, "h-")
        : heightClass;

  const html = useMemo(() => highlightCode(code, lang), [code, lang]);

  return (
    <div
      className={cn(
        "code-block group relative flex flex-col overflow-hidden rounded-xl border border-border",
        "bg-[color-mix(in_oklab,var(--secondary)_88%,var(--foreground)_4%)]",
        "shadow-[inset_0_1px_0_color-mix(in_oklab,var(--foreground)_4%,transparent)]",
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-[color-mix(in_oklab,var(--secondary)_70%,var(--background))] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex gap-1" aria-hidden>
            <span className="size-2 rounded-full bg-foreground/15" />
            <span className="size-2 rounded-full bg-foreground/15" />
            <span className="size-2 rounded-full bg-foreground/15" />
          </span>
          <span className="font-mono text-[11px] font-medium tracking-wide text-muted-foreground">
            {lang || "code"}
          </span>
        </div>
        <button
          type="button"
          title={done ? "已复制" : "复制"}
          aria-label={done ? "已复制" : "复制"}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setDone(true);
              toast.success("已复制");
              window.setTimeout(() => setDone(false), 1500);
            });
          }}
        >
          {done ? (
            <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </button>
      </div>
      <pre
        className={cn(
          "hljs m-0 min-h-0 shrink-0 overflow-x-auto overflow-y-auto p-4",
          "font-mono text-[12.5px] leading-[1.65] text-foreground",
          "whitespace-pre selection:bg-primary/15",
          resolvedHeight,
        )}
        style={{ tabSize: 2, MozTabSize: 2, whiteSpace: "pre" }}
      >
        <code
          className="block whitespace-pre font-mono text-[12.5px]"
          style={{ whiteSpace: "pre", tabSize: 2 }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
    </div>
  );
}
