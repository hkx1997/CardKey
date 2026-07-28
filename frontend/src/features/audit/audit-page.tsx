import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AuditLog } from "@/entities/types";
import {
  DataTable,
  type DataTableColumn,
} from "@/shared/components/data-table";
import { PageContainer } from "@/shared/components/page-container";
import { PageHeader } from "@/shared/components/page-header";
import { useAuditQuery } from "@/shared/hooks/use-audit";
import { usePageSize } from "@/shared/hooks/use-page-size";
import { formatDateTime } from "@/shared/lib/format";

export function AuditPage() {
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize, options: pageSizeOptions } = usePageSize();
  const q = useAuditQuery({ page, pageSize });

  const columns = useMemo<DataTableColumn<AuditLog>[]>(
    () => [
      {
        id: "time",
        header: "时间",
        cellClassName: "whitespace-nowrap text-xs text-muted-foreground",
        cell: (log) => formatDateTime(log.createdAt),
      },
      {
        id: "actor",
        header: "操作者",
        cell: (log) => <Badge variant="outline">{log.actorLabel}</Badge>,
      },
      {
        id: "action",
        header: "动作",
        cellClassName: "font-mono text-xs",
        cell: (log) => log.action,
      },
      {
        id: "resource",
        header: "资源",
        showFrom: "sm",
        cellClassName: "font-mono text-xs text-muted-foreground",
        cell: (log) => log.resource,
      },
      {
        id: "detail",
        header: "详情",
        cellClassName: "max-w-[140px] truncate text-xs sm:max-w-[220px]",
        cell: (log) => log.detail,
      },
      {
        id: "ip",
        header: "IP",
        showFrom: "md",
        cellClassName: "font-mono text-xs",
        cell: (log) => log.ip,
      },
    ],
    [],
  );

  return (
    <PageContainer>
      <PageHeader title="审计日志" description="管理端关键操作留痕" />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">最近操作</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            rows={q.data?.items}
            rowKey={(log) => log.id}
            loading={q.isLoading}
            minWidth={480}
            pagination={{
              page,
              pageSize,
              total: q.data?.total ?? 0,
              onPageChange: setPage,
              onPageSizeChange: (n) => {
                setPageSize(n);
                setPage(1);
              },
              pageSizeOptions,
            }}
            mobileCard={(log) => (
              <div className="space-y-1 rounded-xl border border-border/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline">{log.actorLabel}</Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {formatDateTime(log.createdAt)}
                  </span>
                </div>
                <p className="font-mono text-xs">{log.action}</p>
                <p className="line-clamp-2 text-[11px] text-muted-foreground">
                  {log.detail}
                </p>
              </div>
            )}
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
