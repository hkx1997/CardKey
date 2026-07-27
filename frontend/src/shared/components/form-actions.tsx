import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

/**
 * 表单 / 卡片底部操作区：始终右对齐。
 * 小屏纵向时主按钮在下（flex-col-reverse 保证主操作更靠下拇指区）。
 */
export function FormActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 max-w-full flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end",
        className,
      )}
    >
      {children}
    </div>
  );
}
