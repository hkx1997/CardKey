import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/shared/components/empty-state";
import { PaginationBar } from "@/shared/components/pagination-bar";
import { cn } from "@/shared/lib/cn";

export type DataTableColumn<T> = {
  id: string;
  header: ReactNode;
  /** 单元格内容 */
  cell: (row: T) => ReactNode;
  /** 表头 className */
  headClassName?: string;
  /** 单元格 className */
  cellClassName?: string;
  /**
   * 响应式可见性：默认 always
   * - sm:  ≥640px 显示
   * - md:  ≥768px 显示
   * - lg:  ≥1024px 显示
   */
  showFrom?: "always" | "sm" | "md" | "lg";
  /** 对齐 */
  align?: "left" | "right";
  /**
   * 是否参与窄屏卡片摘要行（默认 true；勾选列等可设 false）
   * 仅在未提供 mobileCard 时使用默认卡片渲染
   */
  mobile?: boolean;
};

const showFromClass: Record<
  NonNullable<DataTableColumn<unknown>["showFrom"]>,
  string
> = {
  always: "",
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

function alignClass(align?: "left" | "right") {
  return align === "right" ? "text-right" : undefined;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  emptyColSpan,
  className,
  minWidth,
  pagination,
  toolbar,
  /** 自定义窄屏卡片；不传则用列默认拼装 */
  mobileCard,
  /** 何时切到卡片：默认 md 以下为卡片 */
  mobileBreakpoint = "md",
}: {
  columns: DataTableColumn<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: ReactNode;
  emptyColSpan?: number;
  className?: string;
  minWidth?: string | number;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange?: (size: number) => void;
    pageSizeOptions?: readonly number[];
    totalExact?: boolean;
    hasMore?: boolean;
  };
  toolbar?: ReactNode;
  mobileCard?: (row: T) => ReactNode;
  mobileBreakpoint?: "sm" | "md";
}) {
  const items = rows ?? [];
  const colCount = emptyColSpan ?? columns.length;
  const isEmpty = !loading && items.length === 0;
  // 只渲染一种布局，避免桌面+移动双倍 cell 开销
  const mq =
    mobileBreakpoint === "sm"
      ? "(max-width: 639px)"
      : "(max-width: 767px)";
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const m = window.matchMedia(mq);
    const apply = () => setIsNarrow(m.matches);
    apply();
    m.addEventListener("change", apply);
    return () => m.removeEventListener("change", apply);
  }, [mq]);
  const useMobileLayout =
    (mobileCard != null || mobileBreakpoint != null) && isNarrow;

  const mobileCols = columns.filter((c) => c.mobile !== false);

  function defaultMobileCard(row: T) {
    const primary = mobileCols.slice(0, 4);
    return (
      <div className="space-y-2 rounded-xl border border-border/70 bg-card p-3">
        {primary.map((col) => (
          <div
            key={col.id}
            className="flex items-start justify-between gap-3 text-xs"
          >
            <span className="shrink-0 text-muted-foreground">
              {typeof col.header === "string" ? col.header : col.id}
            </span>
            <div className={cn("min-w-0 text-right", alignClass(col.align))}>
              {col.cell(row)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const renderCard = mobileCard ?? defaultMobileCard;

  return (
    <div className={cn("space-y-0", className)}>
      {toolbar ? <div className="mb-3">{toolbar}</div> : null}

      {useMobileLayout ? (
        <div className="space-y-2">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={`msk-${i}`} className="h-24 w-full rounded-xl" />
              ))
            : null}
          {!loading &&
            items.map((row) => (
              <div key={rowKey(row)}>{renderCard(row)}</div>
            ))}
          {isEmpty ? (
            <EmptyState className="h-28 rounded-xl border border-dashed">
              {empty ?? "暂无数据"}
            </EmptyState>
          ) : null}
        </div>
      ) : (
        <div className="-mx-1">
          <Table
            className={cn(minWidth != null && "min-w-[var(--dt-min)]")}
            style={
              minWidth != null
                ? ({
                    ["--dt-min" as string]:
                      typeof minWidth === "number" ? `${minWidth}px` : minWidth,
                  } as CSSProperties)
                : undefined
            }
          >
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead
                    key={col.id}
                    className={cn(
                      showFromClass[col.showFrom ?? "always"],
                      alignClass(col.align),
                      col.headClassName,
                    )}
                  >
                    {col.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      {columns.map((col) => (
                        <TableCell
                          key={col.id}
                          className={cn(
                            showFromClass[col.showFrom ?? "always"],
                            col.cellClassName,
                          )}
                        >
                          <Skeleton className="h-4 w-full max-w-[8rem]" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : null}

              {!loading &&
                items.map((row, rowIndex) => (
                  <TableRow
                    key={rowKey(row)}
                    className="stagger-in [content-visibility:auto] [contain-intrinsic-size:auto_48px]"
                    style={
                      {
                        "--stagger": Math.min(rowIndex, 12),
                      } as CSSProperties
                    }
                  >
                    {columns.map((col) => (
                      <TableCell
                        key={col.id}
                        className={cn(
                          showFromClass[col.showFrom ?? "always"],
                          alignClass(col.align),
                          col.cellClassName,
                        )}
                      >
                        {col.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}

              {isEmpty ? (
                <TableRow>
                  <TableCell colSpan={colCount} className="p-0">
                    <EmptyState className="h-28">{empty ?? "暂无数据"}</EmptyState>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      )}

      {pagination ? (
        <PaginationBar
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onPageChange={pagination.onPageChange}
          onPageSizeChange={pagination.onPageSizeChange}
          pageSizeOptions={pagination.pageSizeOptions}
          totalExact={pagination.totalExact}
          hasMore={pagination.hasMore}
        />
      ) : null}
    </div>
  );
}
