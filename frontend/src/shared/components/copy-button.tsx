import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/shared/components/icon-button";
import { cn } from "@/shared/lib/cn";

type CopyProps = {
  value: string;
  label?: string;
  disabled?: boolean;
  className?: string;
  /** 复制成功是否 toast，框内图标默认静默 + 勾选反馈 */
  silent?: boolean;
};

/** 文字按钮形态的复制（表单底部等） */
export function CopyButton({
  value,
  label = "复制",
  size = "sm",
  variant = "outline",
  disabled,
  className,
  silent,
}: CopyProps & {
  size?: "default" | "sm" | "lg" | "icon";
  variant?: "default" | "outline" | "secondary" | "ghost";
}) {
  const [done, setDone] = useState(false);

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      if (!silent) toast.success("已复制到剪贴板");
      window.setTimeout(() => setDone(false), 1500);
    } catch {
      toast.error("复制失败");
    }
  }

  if (size === "icon") {
    return (
      <IconButton
        label={done ? "已复制" : label}
        disabled={disabled || !value}
        className={className}
        onClick={() => void copy()}
      >
        {done ? (
          <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </IconButton>
    );
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      disabled={disabled || !value}
      className={className}
      onClick={() => void copy()}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {label}
    </Button>
  );
}

/** 框内复制图标（默认静默 + 勾选） */
export function CopyIconButton({
  value,
  label = "复制",
  disabled,
  className,
}: CopyProps) {
  return (
    <CopyButton
      value={value}
      label={label}
      size="icon"
      disabled={disabled}
      className={cn(className)}
      silent
    />
  );
}
