import { Download, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { RedeemRecord } from "@/entities/types";
import { CategorySelect } from "@/shared/components/category-select";
import {
  DataTable,
  type DataTableColumn,
} from "@/shared/components/data-table";
import {
  FilterSearchSlot,
  FilterToolbar,
} from "@/shared/components/filter-toolbar";
import { PageContainer } from "@/shared/components/page-container";
import { PageHeader } from "@/shared/components/page-header";
import { useCategoriesQuery } from "@/shared/hooks/use-categories";
import { usePageSize } from "@/shared/hooks/use-page-size";
import { useRedeemsQuery } from "@/shared/hooks/use-redeems";
import { formatDateTime } from "@/shared/lib/format";

const ALL = "__all__";

function toCsv(rows: RedeemRecord[]) {
  const header = ["类别", "编码", "IP", "UA", "时间"];
  const lines = rows.map((r) =>
    [
      r.categoryName ?? r.categorySlug ?? "",
      r.code,
      r.ip,
      r.userAgent.replace(/"/g, '""'),
      r.createdAt,
    ]
      .map((cell) => `"${cell}"`)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function RedeemsPage() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize, options: pageSizeOptions } = usePageSize();
  const [categorySlug, setCategorySlug] = useState(ALL);

  const catsQ = useCategoriesQuery();
  const listQ = useRedeemsQuery({
    page,
    pageSize,
    q: query || undefined,
    categorySlug: categorySlug === ALL ? undefined : categorySlug,
  });

  function runSearch() {
    setPage(1);
    setQuery(q.trim());
  }

  function exportPageCsv() {
    const items = listQ.data?.items ?? [];
    if (items.length === 0) {
      toast.message("当前页无数据可导出");
      return;
    }
    const blob = new Blob(["\uFEFF" + toCsv(items)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `redeems-page-${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`已导出本页 ${items.length} 条`);
  }

  const columns = useMemo<DataTableColumn<RedeemRecord>[]>(
    () => [
      {
        id: "category",
        header: "类别",
        cellClassName: "text-sm",
        cell: (r) => r.categoryName ?? r.categorySlug ?? "—",
      },
      {
        id: "code",
        header: "编码",
        cellClassName:
          "max-w-[120px] truncate font-mono text-xs sm:max-w-none",
        cell: (r) => r.code,
      },
      {
        id: "ip",
        header: "IP",
        showFrom: "sm",
        cellClassName: "font-mono text-xs",
        cell: (r) => r.ip,
      },
      {
        id: "ua",
        header: "UA",
        showFrom: "md",
        cellClassName: "max-w-[200px] truncate text-xs text-muted-foreground",
        cell: (r) => r.userAgent,
      },
      {
        id: "time",
        header: "时间",
        cellClassName: "whitespace-nowrap text-xs text-muted-foreground",
        cell: (r) => formatDateTime(r.createdAt),
      },
    ],
    [],
  );

  return (
    <PageContainer>
      <PageHeader
        title="兑换记录"
        description="成功兑换流水 · 支持按类别筛选与导出本页 CSV"
      />

      <Card>
        <CardHeader className="pb-3">
          <FilterToolbar
            actions={
              <>
                <Button variant="secondary" onClick={runSearch}>
                  搜索
                </Button>
                <Button variant="outline" onClick={exportPageCsv}>
                  <Download />
                  导出本页
                </Button>
              </>
            }
          >
            <FilterSearchSlot>
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="编码 / IP"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runSearch();
                }}
              />
            </FilterSearchSlot>
            <CategorySelect
              className="w-full sm:w-[180px]"
              items={catsQ.data ?? []}
              value={categorySlug}
              onValueChange={(v) => {
                setCategorySlug(v);
                setPage(1);
              }}
              allowAll
              allValue={ALL}
            />
          </FilterToolbar>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            rows={listQ.data?.items}
            rowKey={(r) => r.id}
            loading={listQ.isLoading}
            minWidth={420}
            pagination={{
              page,
              pageSize,
              total: listQ.data?.total ?? 0,
              onPageChange: setPage,
              onPageSizeChange: (n) => {
                setPageSize(n);
                setPage(1);
              },
              pageSizeOptions,
            }}
            mobileCard={(r) => (
              <div className="rounded-xl border border-border/70 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium">
                      {r.categoryName ?? r.categorySlug ?? "—"}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px]">
                      {r.code}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {formatDateTime(r.createdAt)}
                  </span>
                </div>
                <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                  {r.ip}
                </p>
              </div>
            )}
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
