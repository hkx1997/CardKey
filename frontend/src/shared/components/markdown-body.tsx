import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/shared/lib/cn";

type Props = {
  source: string;
  className?: string;
  /** 截断长度，默认 8000 */
  maxLen?: number;
};

/**
 * 轻量 Markdown 渲染（Release 说明 / 更新内容）。
 * 支持 GFM：标题、列表、链接、代码块、表格等。
 */
export function MarkdownBody({ source, className, maxLen = 8000 }: Props) {
  const text = (source || "").trim().slice(0, maxLen);
  if (!text) return null;

  return (
    <div
      className={cn(
        "markdown-body max-h-56 overflow-auto rounded-lg border border-border/60 bg-background/60 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h3 className="mb-1.5 mt-2 text-sm font-semibold text-foreground first:mt-0">
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h3 className="mb-1.5 mt-2 text-sm font-semibold text-foreground first:mt-0">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mb-1 mt-2 text-xs font-semibold text-foreground first:mt-0">
              {children}
            </h4>
          ),
          h4: ({ children }) => (
            <h4 className="mb-1 mt-1.5 text-xs font-medium text-foreground first:mt-0">
              {children}
            </h4>
          ),
          p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="mb-1.5 list-disc space-y-0.5 pl-4 last:mb-0">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-1.5 list-decimal space-y-0.5 pl-4 last:mb-0">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-snug">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline underline-offset-2"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ className: codeClass, children }) => {
            const isBlock = !!codeClass?.includes("language-");
            if (isBlock) {
              return (
                <code className="block overflow-x-auto rounded bg-secondary/80 p-2 font-mono text-[10px] text-foreground">
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-secondary/70 px-1 py-0.5 font-mono text-[10px] text-foreground">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="mb-1.5 overflow-x-auto rounded-md bg-secondary/50 p-0 last:mb-0">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-1.5 border-l-2 border-border pl-2 text-muted-foreground/90">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-2 border-border/70" />,
          table: ({ children }) => (
            <div className="mb-1.5 overflow-x-auto">
              <table className="w-full min-w-[240px] border-collapse text-left">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border px-1.5 py-1 font-medium text-foreground">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border/50 px-1.5 py-1">{children}</td>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
