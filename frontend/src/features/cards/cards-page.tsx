import {
  Ban,
  CheckCircle,
  Copy,
  Download,
  Eye,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { CopyIconButton } from "@/shared/components/copy-button";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Card as CardEntity, CardStatus } from "@/entities/types";
import { CreateCardDialog } from "@/features/cards/create-card-dialog";
import { CardContentView } from "@/shared/components/card-content-view";
import { CategorySelect } from "@/shared/components/category-select";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  cardTypeLabel,
  formatBytes,
} from "@/shared/lib/card-content";
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
import {
  useBatchCardAction,
  useCardDetail,
  useCardsQuery,
  useExportCards,
} from "@/shared/hooks/use-cards";
import { useCategoriesQuery } from "@/shared/hooks/use-categories";
import { TaskProgress } from "@/shared/components/task-progress";
import {
  downloadCodesTxt,
  exportFilename,
} from "@/shared/lib/export-codes";
import { useListCursor } from "@/shared/hooks/use-list-cursor";
import { usePageSize } from "@/shared/hooks/use-page-size";
import { formatDateTime } from "@/shared/lib/format";
import { CardStatusBadge } from "@/shared/lib/status";

const ALL = "__all__";

/** 可勾选：未使用/禁用（禁用/删除）+ 已兑换（可复原启用） */
function isSelectable(card: CardEntity) {
  return (
    card.status === "unused" ||
    card.status === "disabled" ||
    card.status === "used"
  );
}

function copyCode(code: string, e?: React.MouseEvent) {
  e?.stopPropagation();
  e?.preventDefault();
  void navigator.clipboard.writeText(code).then(
    () => toast.success("已复制卡密"),
    () => toast.error("复制失败"),
  );
}

export function CardsPage() {
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const batchFromUrl = searchParams.get("batch") || undefined;
  const { pageSize, setPageSize, options: pageSizeOptions } = usePageSize();
  const [status, setStatus] = useState<CardStatus | "all">("all");
  const [categorySlug, setCategorySlug] = useState(ALL);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);

  const filterKey = `${status}|${categorySlug}|${query}|${batchFromUrl ?? ""}|${pageSize}`;
  const {
    page,
    setPage,
    cursor,
    rememberNext,
    reset: resetCursor,
  } = useListCursor(filterKey);

  const catsQ = useCategoriesQuery({ light: true });
  const listQ = useCardsQuery({
    page,
    pageSize,
    status,
    q: query || undefined,
    categorySlug: categorySlug === ALL ? undefined : categorySlug,
    batchId: batchFromUrl,
    cursor: cursor || undefined,
  });

  useEffect(() => {
    if (listQ.data?.nextCursor) {
      rememberNext(page, listQ.data.nextCursor);
    }
  }, [listQ.data?.nextCursor, page, rememberNext]);
  const detailQ = useCardDetail(detailId, reveal);
  const actionM = useBatchCardAction();
  const exportM = useExportCards();
  const [exportProgress, setExportProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const pageItems = listQ.data?.items ?? [];
  const selectableOnPage = pageItems.filter(isSelectable);
  const allPageSelected =
    selectableOnPage.length > 0 &&
    selectableOnPage.every((c) => selected.has(c.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const c of selectableOnPage) next.delete(c.id);
      } else {
        for (const c of selectableOnPage) next.add(c.id);
      }
      return next;
    });
  }

  function runSearch() {
    setPage(1);
    setQuery(q.trim());
    setSelected(new Set());
  }

  function copySelectedCodes() {
    const codes = pageItems
      .filter((c) => selected.has(c.id))
      .map((c) => c.code);
    if (codes.length === 0) {
      // selected may span pages not in current view — still allow from known list
      toast.message("当前页无已选编码，请在本页勾选后复制");
      return;
    }
    void navigator.clipboard.writeText(codes.join("\n")).then(
      () => toast.success(`已复制 ${codes.length} 个编码`),
      () => toast.error("复制失败"),
    );
  }

  /** 批量导出：有勾选则导已选，否则按当前筛选导出全部（一行一个 .txt） */
  function runExport(mode: "selected" | "filter") {
    if (exportM.isPending) return;
    const onProgress = (done: number, total: number) =>
      setExportProgress({ done, total });
    if (mode === "selected") {
      const ids = [...selected];
      if (ids.length === 0) {
        toast.message("请先勾选要导出的卡密");
        return;
      }
      setExportProgress({ done: 0, total: ids.length });
      exportM.mutate(
        { params: { ids }, onProgress },
        {
          onSuccess: (res) => {
            downloadCodesTxt(
              res.codes,
              exportFilename("cards-selected", res.total),
            );
            toast.success(`已导出 ${res.total} 个编码`);
          },
          onSettled: () => setExportProgress(null),
        },
      );
      return;
    }
    const total = listQ.data?.total ?? 0;
    if (total === 0) {
      toast.message("当前筛选下没有卡密可导出");
      return;
    }
    setExportProgress({ done: 0, total });
    exportM.mutate(
      {
        params: {
          status,
          q: query || undefined,
          categorySlug: categorySlug === ALL ? undefined : categorySlug,
          batchId: batchFromUrl,
        },
        onProgress,
      },
      {
        onSuccess: (res) => {
          downloadCodesTxt(res.codes, exportFilename("cards", res.total));
          toast.success(`已导出 ${res.total} 个编码（一行一个）`);
        },
        onSettled: () => setExportProgress(null),
      },
    );
  }

  async function runBatch(action: "disable" | "enable" | "delete") {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (action === "delete") {
      const ok = await confirm({
        title: `删除 ${ids.length} 条卡密`,
        description:
          "仅删除未使用/已禁用的卡密；已兑换与过期不会被删除。此操作不可恢复。",
        confirmLabel: "删除",
        destructive: true,
      });
      if (!ok) return;
    }
    if (action === "enable") {
      const usedN = pageItems.filter(
        (c) => selected.has(c.id) && c.status === "used",
      ).length;
      const ok = await confirm({
        title: `启用 / 复原 ${ids.length} 条卡密`,
        description:
          usedN > 0
            ? `其中约 ${usedN} 条为已兑换，将清空兑换时间并恢复为「未使用」，可再次被兑换。历史兑换记录仍保留在「兑换记录」中。`
            : "将选中的已禁用卡密恢复为「未使用」。",
        confirmLabel: usedN > 0 ? "启用并复原" : "启用",
        destructive: usedN > 0,
      });
      if (!ok) return;
    }
    if (action === "disable") {
      // 只对未使用生效；已兑换不会被改
    }
    actionM.mutate(
      { ids, action },
      { onSuccess: () => setSelected(new Set()) },
    );
  }

  // 业务列稳定（不因勾选重建）；仅 select 列随 selected 更新
  const dataColumns = useMemo<DataTableColumn<CardEntity>[]>(
    () => [
      {
        id: "code",
        header: "编码",
        cellClassName: "max-w-[200px] sm:max-w-none",
        cell: (card) => (
          <div className="flex min-w-0 items-center gap-0.5">
            <button
              type="button"
              title="点击复制"
              className="min-w-0 truncate text-left font-mono text-xs text-foreground hover:text-primary hover:underline"
              onClick={(e) => copyCode(card.code, e)}
            >
              {card.code}
            </button>
            <CopyIconButton
              value={card.code}
              label="复制卡密"
              className="size-7 shrink-0"
            />
          </div>
        ),
      },
      {
        id: "category",
        header: "类别",
        cell: (card) => (
          <Badge variant="secondary">
            {card.categoryName ?? card.categorySlug}
          </Badge>
        ),
      },
      {
        id: "type",
        header: "类型",
        showFrom: "md",
        cell: (card) => (
          <div className="min-w-0 space-y-0.5">
            <Badge variant="outline">{cardTypeLabel(card.type)}</Badge>
            {card.filename ? (
              <p className="max-w-[140px] truncate text-[10px] text-muted-foreground">
                {card.filename}
                {card.size != null && card.size > 0
                  ? ` · ${formatBytes(card.size)}`
                  : ""}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: "status",
        header: "状态",
        cell: (card) => <CardStatusBadge status={card.status} />,
      },
      {
        id: "batch",
        header: "批次",
        showFrom: "lg",
        cellClassName: "text-muted-foreground",
        cell: (card) => card.batchName ?? "—",
      },
      {
        id: "created",
        header: "创建时间",
        showFrom: "sm",
        cellClassName: "text-xs text-muted-foreground whitespace-nowrap",
        cell: (card) => formatDateTime(card.createdAt),
      },
      {
        id: "actions",
        header: "操作",
        align: "right",
        cell: (card) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setReveal(false);
              setDetailId(card.id);
            }}
          >
            <Eye />
            详情
          </Button>
        ),
      },
    ],
    [],
  );

  const columns = useMemo<DataTableColumn<CardEntity>[]>(
    () => [
      {
        id: "select",
        header: (
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={allPageSelected}
            onChange={toggleAllPage}
            disabled={selectableOnPage.length === 0}
            aria-label="全选本页"
          />
        ),
        headClassName: "w-10",
        mobile: false,
        cell: (card) => (
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={selected.has(card.id)}
            onChange={() => toggle(card.id)}
            disabled={!isSelectable(card)}
            aria-label={`选择 ${card.code}`}
          />
        ),
      },
      ...dataColumns,
    ],
    [
      allPageSelected,
      selectableOnPage.length,
      selected,
      dataColumns,
      // toggle/toggleAllPage 稳定于组件内声明
    ],
  );

  return (
    <PageContainer>
      <PageHeader
        title="卡密管理"
        description={
          batchFromUrl
            ? "当前按批次筛选 · 可清除筛选后查看全部"
            : "按类别隔离的库存；支持批量导出、启用/复原（含已兑换）、禁用、删除"
        }
        actions={
          <>
            {batchFromUrl ? (
              <Button
                variant="outline"
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete("batch");
                  setSearchParams(next);
                  setPage(1);
                  setSelected(new Set());
                }}
              >
                清除批次筛选
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={exportM.isPending || (listQ.data?.total ?? 0) === 0}
              onClick={() => runExport("filter")}
            >
              <Download />
              导出
            </Button>
            <Button variant="outline" asChild className="sm:w-auto">
              <Link to="/admin/cards/import">批量导入</Link>
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              新建
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <FilterToolbar
            actions={
              <>
                <Button variant="secondary" onClick={runSearch}>
                  搜索
                </Button>
                {selected.size > 0 ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copySelectedCodes}
                    >
                      <Copy />
                      复制编码
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exportM.isPending}
                      onClick={() => runExport("selected")}
                    >
                      <Download />
                      导出已选 ({selected.size})
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void runBatch("disable")}
                      disabled={actionM.isPending}
                    >
                      <Ban />
                      禁用 ({selected.size})
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void runBatch("enable")}
                      disabled={actionM.isPending}
                    >
                      <CheckCircle />
                      启用/复原
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => void runBatch("delete")}
                      disabled={actionM.isPending}
                    >
                      <Trash2 />
                      删除
                    </Button>
                  </>
                ) : null}
              </>
            }
          >
            <FilterSearchSlot>
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="搜索编码 / 备注"
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
                setSelected(new Set());
              }}
              allowAll
              allValue={ALL}
            />
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v as CardStatus | "all");
                setPage(1);
                setSelected(new Set());
              }}
            >
              <SelectTrigger className="w-full sm:w-[130px]">
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="unused">未使用</SelectItem>
                <SelectItem value="used">已兑换</SelectItem>
                <SelectItem value="disabled">已禁用</SelectItem>
                <SelectItem value="expired">已过期</SelectItem>
              </SelectContent>
            </Select>
          </FilterToolbar>
        </CardHeader>
        <CardContent className="space-y-3">
          {exportProgress || actionM.isPending ? (
            <TaskProgress
              active={exportM.isPending || actionM.isPending}
              percent={
                exportProgress && exportProgress.total > 0
                  ? (exportProgress.done / exportProgress.total) * 100
                  : actionM.isPending
                    ? undefined
                    : 100
              }
              label={
                exportM.isPending
                  ? "正在导出编码…"
                  : actionM.isPending
                    ? "正在批量处理卡密…"
                    : "完成"
              }
              detail={
                exportProgress
                  ? `${exportProgress.done} / ${exportProgress.total}`
                  : undefined
              }
            />
          ) : null}
          <DataTable
            columns={columns}
            rows={listQ.data?.items}
            rowKey={(c) => c.id}
            loading={listQ.isLoading}
            minWidth={640}
            pagination={{
              page,
              pageSize,
              total: listQ.data?.total ?? 0,
              totalExact: listQ.data?.totalExact,
              hasMore: listQ.data?.hasMore,
              onPageChange: setPage,
              onPageSizeChange: (n) => {
                setPageSize(n);
                resetCursor();
              },
              pageSizeOptions,
            }}
            mobileCard={(card) => (
              <div className="space-y-2.5 rounded-xl border border-border/70 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-0.5">
                      <button
                        type="button"
                        title="点击复制"
                        className="min-w-0 truncate text-left font-mono text-xs font-medium hover:text-primary hover:underline"
                        onClick={(e) => copyCode(card.code, e)}
                      >
                        {card.code}
                      </button>
                      <CopyIconButton
                        value={card.code}
                        label="复制卡密"
                        className="size-7 shrink-0"
                      />
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Badge variant="secondary">
                        {card.categoryName ?? card.categorySlug}
                      </Badge>
                      <Badge variant="outline">{cardTypeLabel(card.type)}</Badge>
                      <CardStatusBadge status={card.status} />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={selected.has(card.id)}
                      onChange={() => toggle(card.id)}
                      disabled={!isSelectable(card)}
                      aria-label={`选择 ${card.code}`}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setReveal(false);
                        setDetailId(card.id);
                      }}
                    >
                      <Eye />
                    </Button>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {formatDateTime(card.createdAt)}
                  {card.batchName ? ` · ${card.batchName}` : ""}
                  {card.filename
                    ? ` · ${card.filename}${card.size ? ` (${formatBytes(card.size)})` : ""}`
                    : ""}
                </p>
              </div>
            )}
          />
        </CardContent>
      </Card>

      <CreateCardDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        categories={catsQ.data ?? []}
      />

      <Dialog
        open={!!detailId}
        onOpenChange={(o) => {
          if (!o) {
            setDetailId(null);
            setReveal(false);
          }
        }}
      >
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>卡密详情</DialogTitle>
            <DialogDescription asChild>
              <div className="flex items-start gap-1">
                <button
                  type="button"
                  title="点击复制"
                  className="min-w-0 flex-1 break-all text-left font-mono text-xs text-muted-foreground hover:text-primary hover:underline"
                  onClick={(e) =>
                    detailQ.data?.code && copyCode(detailQ.data.code, e)
                  }
                >
                  {detailQ.data?.code}
                </button>
                {detailQ.data?.code ? (
                  <CopyIconButton
                    value={detailQ.data.code}
                    label="复制卡密"
                    className="size-7 shrink-0"
                  />
                ) : null}
              </div>
            </DialogDescription>
          </DialogHeader>
          {detailQ.data && (
            <div className="dialog-body space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <CardStatusBadge status={detailQ.data.status} />
                <Badge variant="outline">
                  {cardTypeLabel(detailQ.data.type)}
                </Badge>
                <Badge variant="secondary">{detailQ.data.categoryName}</Badge>
              </div>
              <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <div>批次：{detailQ.data.batchName ?? "—"}</div>
                <div>备注：{detailQ.data.note || "—"}</div>
                <div>创建：{formatDateTime(detailQ.data.createdAt)}</div>
                <div>兑换：{formatDateTime(detailQ.data.usedAt)}</div>
              </div>
              <div className="min-w-0 space-y-1">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Label>内容</Label>
                  {!reveal ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setReveal(true)}
                    >
                      显示内容
                    </Button>
                  ) : null}
                </div>
                {detailQ.data.filename || detailQ.data.size ? (
                  <p className="text-[11px] text-muted-foreground">
                    {detailQ.data.filename || "—"}
                    {detailQ.data.mime ? ` · ${detailQ.data.mime}` : ""}
                    {detailQ.data.size
                      ? ` · ${(detailQ.data.size / 1024).toFixed(1)} KB`
                      : ""}
                  </p>
                ) : null}
                {reveal && detailQ.data.content != null ? (
                  <CardContentView
                    type={detailQ.data.type}
                    content={detailQ.data.content}
                    contentEncoding={detailQ.data.contentEncoding}
                    filename={detailQ.data.filename}
                    mime={detailQ.data.mime}
                    size={detailQ.data.size}
                  />
                ) : (
                  <pre className="max-h-40 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
                    •••••••• 点击显示内容（将记入审计）
                  </pre>
                )}
              </div>
              {isSelectable(detailQ.data) ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {detailQ.data.status === "unused" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actionM.isPending}
                      onClick={() => {
                        actionM.mutate(
                          { ids: [detailQ.data!.id], action: "disable" },
                          { onSuccess: () => setDetailId(null) },
                        );
                      }}
                    >
                      禁用
                    </Button>
                  ) : null}
                  {detailQ.data.status === "disabled" ||
                  detailQ.data.status === "used" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actionM.isPending}
                      onClick={async () => {
                        if (detailQ.data!.status === "used") {
                          const ok = await confirm({
                            title: "复原已兑换卡密",
                            description:
                              "将清空兑换时间并恢复为「未使用」，可再次被兑换。历史兑换记录仍保留。",
                            confirmLabel: "复原",
                            destructive: true,
                          });
                          if (!ok) return;
                        }
                        actionM.mutate(
                          { ids: [detailQ.data!.id], action: "enable" },
                          { onSuccess: () => setDetailId(null) },
                        );
                      }}
                    >
                      {detailQ.data.status === "used" ? "复原为未使用" : "启用"}
                    </Button>
                  ) : null}
                  {detailQ.data.status === "unused" ||
                  detailQ.data.status === "disabled" ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={actionM.isPending}
                      onClick={async () => {
                        const ok = await confirm({
                          title: "删除该卡密",
                          description: `确认删除 ${detailQ.data!.code}？不可恢复。`,
                          confirmLabel: "删除",
                          destructive: true,
                        });
                        if (!ok) return;
                        actionM.mutate(
                          { ids: [detailQ.data!.id], action: "delete" },
                          { onSuccess: () => setDetailId(null) },
                        );
                      }}
                    >
                      删除
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
