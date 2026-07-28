import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  totalExact = true,
  hasMore,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** 提供时显示「每页条数」选择器 */
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: readonly number[];
  /** false 时显示「约 N 条」 */
  totalExact?: boolean;
  /** 有值时优先用 hasMore 控制下一页，避免估算 total 误伤 */
  hasMore?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
  const canPrev = page > 1;
  const canNext =
    hasMore != null ? hasMore : page < totalPages;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <span className="tabular-nums">
        {totalExact === false && total <= 0
          ? hasMore
            ? "更多…"
            : "本页"
          : totalExact === false
            ? `约 ${total.toLocaleString()} 条`
            : `共 ${total.toLocaleString()} 条`}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {onPageSizeChange ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs whitespace-nowrap">每页</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                onPageSizeChange(Number(v));
                onPageChange(1);
              }}
            >
              <SelectTrigger className="h-8 w-[4.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs">条</span>
          </div>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="min-w-16"
          disabled={!canPrev}
          onClick={() => onPageChange(page - 1)}
        >
          上一页
        </Button>
        <span className="min-w-[3.5rem] text-center tabular-nums">
          {page}
          {totalExact !== false ? ` / ${totalPages}` : ""}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="min-w-16"
          disabled={!canNext}
          onClick={() => onPageChange(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}
