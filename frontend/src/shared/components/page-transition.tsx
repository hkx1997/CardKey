import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { cn } from "@/shared/lib/cn";

/** 路由切换时整页内容入场动画 */
export function PageTransition({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className={cn("page-enter", className)}>
      {children}
    </div>
  );
}
