import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

/**
 * 列表筛选条：左侧筛选控件，右侧操作按钮（搜索/批量等始终靠右）。
 */
export function FilterToolbar({
  children,
  actions,
  className,
}: {
  children?: ReactNode;
  /** 右侧操作区（搜索、批量启用等） */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {children}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** 搜索输入外包：占满剩余宽度 */
export function FilterSearchSlot({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative min-w-0 w-full flex-1 sm:min-w-[180px] sm:max-w-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}
