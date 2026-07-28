import { Loader2 } from "lucide-react";

import { cn } from "@/shared/lib/cn";

export type TaskProgressState = {
  /** 0–100；不传则不确定进度 */
  percent?: number;
  /** 主文案，如「正在导入」 */
  label?: string;
  /** 副文案，如「128 / 500」 */
  detail?: string;
  /** 进行中 */
  active?: boolean;
};

/**
 * 通用任务进度条：导入 / 导出 / 批量操作 / 更新 等耗时任务。
 */
export function TaskProgress({
  percent,
  label,
  detail,
  active = true,
  className,
}: TaskProgressState & { className?: string }) {
  if (!active && percent == null) return null;
  const determinate =
    typeof percent === "number" && Number.isFinite(percent) && percent >= 0;
  const pct = determinate ? Math.min(100, Math.max(0, percent!)) : 0;

  return (
    <div
      className={cn(
        "space-y-1.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy={active}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-foreground">
          {active ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
          ) : null}
          <span className="truncate">{label || (active ? "处理中…" : "已完成")}</span>
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {detail
            ? detail
            : determinate
              ? `${Math.round(pct)}%`
              : active
                ? "…"
                : "100%"}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        {determinate ? (
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className="task-progress-indeterminate h-full w-1/3 rounded-full bg-primary" />
        )}
      </div>
    </div>
  );
}

/** 简单进度状态构造 */
export function progressOf(
  done: number,
  total: number,
  label?: string,
): TaskProgressState {
  const t = Math.max(0, total);
  const d = Math.max(0, Math.min(done, t || done));
  const percent = t > 0 ? (d / t) * 100 : undefined;
  return {
    active: t === 0 || d < t,
    percent,
    label,
    detail: t > 0 ? `${d} / ${t}` : undefined,
  };
}
