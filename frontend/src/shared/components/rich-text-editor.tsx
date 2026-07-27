import {
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  Underline,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/shared/lib/cn";
import { sanitizeHtml } from "@/shared/lib/sanitize-html";

/**
 * 轻量富文本编辑器（contentEditable + document.execCommand）
 * 未引入 Tiptap/Quill；强制断行，避免长串撑破弹窗。
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder = "输入描述…",
  className,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value !== last.current && el.innerHTML !== value) {
      el.innerHTML = value || "";
      last.current = value;
    }
  }, [value]);

  function emit() {
    const el = ref.current;
    if (!el) return;
    const html = sanitizeHtml(el.innerHTML);
    last.current = html;
    onChange(html);
  }

  function cmd(command: string, arg?: string) {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  }

  function setLink() {
    const url = window.prompt("链接地址", "https://");
    if (!url) return;
    cmd("createLink", url);
  }

  return (
    <div
      className={cn(
        "rich-text-editor-shell min-w-0 max-w-full overflow-hidden rounded-lg border border-border/70 bg-background",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap gap-0.5 border-b border-border/60 bg-secondary/40 p-1">
        <ToolBtn title="粗体" onClick={() => cmd("bold")}>
          <Bold className="size-3.5" />
        </ToolBtn>
        <ToolBtn title="斜体" onClick={() => cmd("italic")}>
          <Italic className="size-3.5" />
        </ToolBtn>
        <ToolBtn title="下划线" onClick={() => cmd("underline")}>
          <Underline className="size-3.5" />
        </ToolBtn>
        <ToolBtn title="无序列表" onClick={() => cmd("insertUnorderedList")}>
          <List className="size-3.5" />
        </ToolBtn>
        <ToolBtn title="有序列表" onClick={() => cmd("insertOrderedList")}>
          <ListOrdered className="size-3.5" />
        </ToolBtn>
        <ToolBtn title="链接" onClick={setLink}>
          <Link2 className="size-3.5" />
        </ToolBtn>
      </div>
      <div
        ref={ref}
        contentEditable
        role="textbox"
        aria-multiline
        data-placeholder={placeholder}
        className={cn(
          "rich-text-editor box-border min-h-[120px] max-h-[240px] min-w-0 w-full max-w-full",
          "overflow-x-hidden overflow-y-auto px-3 py-2 text-sm outline-none",
        )}
        onInput={emit}
        onBlur={emit}
        suppressContentEditableWarning
      />
    </div>
  );
}

function ToolBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7 shrink-0"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      {children}
    </Button>
  );
}
