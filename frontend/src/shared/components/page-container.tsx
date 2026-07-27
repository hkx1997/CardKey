import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

/** 统一页面内边距与纵向节奏 */
export function PageContainer({
  children,
  className,
  narrow,
}: {
  children: ReactNode;
  className?: string;
  /** 公开页偏窄内容 */
  narrow?: boolean;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full flex-1",
        narrow
          ? "max-w-3xl px-4 py-8 sm:px-5 sm:py-10"
          : "space-y-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
