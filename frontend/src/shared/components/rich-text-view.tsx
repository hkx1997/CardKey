import { cn } from "@/shared/lib/cn";
import { isEmptyHtml, sanitizeHtml } from "@/shared/lib/sanitize-html";

export function RichTextView({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  if (isEmptyHtml(html ?? "")) return null;
  const safe = sanitizeHtml(html);
  return (
    <div
      className={cn(
        "rich-text-view rounded-xl border border-border/60 bg-secondary/25 px-4 py-3 text-sm leading-relaxed text-foreground",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_p]:my-1.5 [&_strong]:font-semibold",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
