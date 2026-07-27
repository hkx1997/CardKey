import { Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Batch } from "@/entities/types";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  DataTable,
  type DataTableColumn,
} from "@/shared/components/data-table";
import { PageContainer } from "@/shared/components/page-container";
import { PageHeader } from "@/shared/components/page-header";
import { useBatchesQuery, useDeleteBatch } from "@/shared/hooks/use-batches";
import { formatDateTime } from "@/shared/lib/format";

export function BatchesPage() {
  const confirm = useConfirm();
  const q = useBatchesQuery();
  const deleteM = useDeleteBatch();

  async function handleDelete(b: Batch) {
    const usedLike = b.cardCount - b.unusedCount;
    if (usedLike > 0) {
      // 可能含 used/disabled/expired；后端再校验 used/expired
    }
    const ok = await confirm({
      title: `删除批次「${b.name}」`,
      description:
        b.cardCount === 0
          ? "将删除空批次记录。"
          : `将删除该批次及其中未使用/已禁用的 ${b.unusedCount} 条卡密。若存在已兑换/过期卡密则无法删除。`,
      confirmLabel: "删除",
      destructive: true,
    });
    if (!ok) return;
    deleteM.mutate(b.id);
  }

  const columns = useMemo<DataTableColumn<Batch>[]>(
    () => [
      {
        id: "name",
        header: "名称",
        cellClassName: "font-medium max-w-[140px] truncate sm:max-w-none",
        cell: (b) => b.name,
      },
      {
        id: "category",
        header: "类别",
        cellClassName: "text-sm",
        cell: (b) => b.categoryName ?? "—",
      },
      {
        id: "note",
        header: "备注",
        showFrom: "sm",
        cellClassName: "text-muted-foreground max-w-[160px] truncate",
        cell: (b) => b.note || "—",
      },
      {
        id: "total",
        header: "总量",
        cellClassName: "tabular-nums",
        cell: (b) => b.cardCount,
      },
      {
        id: "unused",
        header: "未使用",
        cellClassName: "tabular-nums text-success",
        cell: (b) => b.unusedCount,
      },
      {
        id: "created",
        header: "创建时间",
        showFrom: "md",
        cellClassName: "text-xs text-muted-foreground whitespace-nowrap",
        cell: (b) => formatDateTime(b.createdAt),
      },
      {
        id: "actions",
        header: "操作",
        align: "right",
        cell: (b) => (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/admin/cards?batch=${b.id}`}>查看卡密</Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={deleteM.isPending}
              onClick={() => void handleDelete(b)}
            >
              <Trash2 />
              <span className="hidden sm:inline">删除</span>
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deleteM.isPending],
  );

  return (
    <PageContainer>
      <PageHeader
        title="批次"
        description="按导入批次管理库存；无已兑卡密时可删除批次"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">批次列表</CardTitle>
          <CardDescription className="text-xs">
            新建批次请在批量导入时填写批次名
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            rows={q.data}
            rowKey={(b) => b.id}
            loading={q.isLoading}
            minWidth={560}
            mobileCard={(b) => (
              <div className="rounded-xl border border-border/70 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{b.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {b.categoryName ?? "—"}
                      {b.note ? ` · ${b.note}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <div className="text-right text-xs tabular-nums">
                      <p className="text-success">{b.unusedCount} 未用</p>
                      <p className="text-muted-foreground">共 {b.cardCount}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => void handleDelete(b)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
