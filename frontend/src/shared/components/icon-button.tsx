import type { ButtonHTMLAttributes, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/shared/lib/cn";

/** 紧凑图标按钮：用于密钥框内、表格行内操作 */
export function IconButton({
  label,
  children,
  className,
  variant = "ghost",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  /** 无障碍与 title */
  label: string;
  children: ReactNode;
  variant?: "ghost" | "outline" | "secondary" | "destructive" | "default";
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant={variant}
      title={label}
      aria-label={label}
      className={cn(
        "size-8 shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}
