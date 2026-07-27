import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

export function EmptyState({
  children = "暂无数据",
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-24 items-center justify-center text-sm text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
