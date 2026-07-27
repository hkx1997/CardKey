import {
  Activity,
  CheckCircle2,
  FolderTree,
  KeyRound,
  Percent,
  Ticket,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { RedeemRecord } from "@/entities/types";
import {
  DataTable,
  type DataTableColumn,
} from "@/shared/components/data-table";
import { PageContainer } from "@/shared/components/page-container";
import { PageHeader } from "@/shared/components/page-header";
import { useDashboardQuery } from "@/shared/hooks/use-dashboard";
import { CategoryIconView } from "@/shared/lib/category-icons";
import { cn } from "@/shared/lib/cn";
import { formatDateTime, formatRelative } from "@/shared/lib/format";
import { CardStatusBadge } from "@/shared/lib/status";

export function DashboardPage() {
  const q = useDashboardQuery();

  const stats = q.data;
  const maxTrend = Math.max(1, ...(stats?.trend.map((t) => t.count) ?? [1]));
  const delta =
    stats != null
      ? stats.todayRedeems - stats.yesterdayRedeems
      : 0;

  const recentCols = useMemo<DataTableColumn<RedeemRecord>[]>(
    () => [
      {
        id: "category",
        header: "类别",
        cellClassName: "text-xs",
        cell: (r) => r.categoryName ?? r.categorySlug ?? "—",
      },
      {
        id: "code",
        header: "编码",
        cellClassName: "max-w-[120px] truncate font-mono text-[10px]",
        cell: (r) => r.code,
      },
      {
        id: "time",
        header: "时间",
        cellClassName: "text-[10px] text-muted-foreground whitespace-nowrap",
        cell: (r) => (
          <span title={formatDateTime(r.createdAt)}>
            {formatRelative(r.createdAt)}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <PageContainer className="space-y-8 fade-in">
      <PageHeader
        title="仪表盘"
        description="库存、兑换与类别健康度一览"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="卡密总量"
          value={stats?.totalCards}
          icon={Ticket}
          loading={q.isLoading}
          hint={`未用 ${stats?.unusedCards ?? "—"} · 已兑 ${stats?.usedCards ?? "—"}`}
        />
        <StatCard
          title="今日兑换"
          value={stats?.todayRedeems}
          icon={TrendingUp}
          loading={q.isLoading}
          hint={
            delta === 0
              ? "与昨日持平"
              : delta > 0
                ? `较昨日 +${delta}`
                : `较昨日 ${delta}`
          }
          trend={delta}
        />
        <StatCard
          title="近 7 日兑换"
          value={stats?.weekRedeems}
          icon={Activity}
          loading={q.isLoading}
          hint={`累计 ${stats?.totalRedeems ?? 0} 次`}
        />
        <StatCard
          title="整体核销率"
          value={stats?.redeemRate}
          suffix="%"
          icon={Percent}
          loading={q.isLoading}
          hint={`禁用 ${stats?.disabledCards ?? 0} · 过期 ${stats?.expiredCards ?? 0}`}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MiniStat
          label="启用类别"
          value={`${stats?.enabledCategories ?? 0} / ${stats?.totalCategories ?? 0}`}
          icon={FolderTree}
          loading={q.isLoading}
        />
        <MiniStat
          label="有效 API Key"
          value={String(stats?.activeApiKeys ?? 0)}
          icon={KeyRound}
          loading={q.isLoading}
        />
        <MiniStat
          label="库存健康"
          value={
            stats
              ? stats.unusedCards > 0
                ? "充足"
                : "需补货"
              : "—"
          }
          icon={CheckCircle2}
          loading={q.isLoading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">近 14 日兑换趋势</CardTitle>
            <CardDescription className="text-xs">
              按日统计成功兑换次数
            </CardDescription>
          </CardHeader>
          <CardContent>
            {q.isLoading ? (
              <Skeleton className="h-44 w-full" />
            ) : (
              <div className="flex h-44 items-end gap-1">
                {stats?.trend.map((t) => (
                  <div
                    key={t.date}
                    className="group flex flex-1 flex-col items-center gap-1"
                    title={`${t.date}: ${t.count}`}
                  >
                    <span className="text-[9px] tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                      {t.count}
                    </span>
                    <div
                      className="w-full max-w-6 rounded-t-sm bg-primary/75 transition-all duration-300 group-hover:bg-primary"
                      style={{
                        height: `${Math.max(6, (t.count / maxTrend) * 100)}%`,
                      }}
                    />
                    <span className="text-[9px] text-muted-foreground">
                      {t.date.slice(3)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">状态分布</CardTitle>
            <CardDescription className="text-xs">当前库存快照</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {q.isLoading ? (
              <Skeleton className="h-36 w-full" />
            ) : (
              stats?.statusBreakdown.map((row) => {
                const pct = stats.totalCards
                  ? Math.round((row.count / stats.totalCards) * 100)
                  : 0;
                return (
                  <div key={row.status} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <CardStatusBadge status={row.status} />
                      <span className="tabular-nums text-muted-foreground">
                        {row.count} · {pct}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          row.status === "unused" && "bg-emerald-500/80",
                          row.status === "used" && "bg-foreground/40",
                          row.status === "disabled" && "bg-destructive/70",
                          row.status === "expired" && "bg-amber-500/70",
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">类别库存</CardTitle>
            <CardDescription className="text-xs">
              各类别未用 / 总量与核销率
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {q.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              stats?.byCategory.map((c) => (
                <div
                  key={c.slug}
                  className="flex items-center gap-3 rounded-lg bg-secondary/40 px-3 py-2.5 transition-colors hover:bg-secondary/70"
                >
                  <div className="flex size-8 items-center justify-center rounded-md bg-background">
                    <CategoryIconView icon={c.icon} size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium">
                        {c.name}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {c.unused}/{c.total}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-background">
                      <div
                        className="h-full rounded-full bg-primary/70 transition-all duration-500"
                        style={{ width: `${c.redeemRate}%` }}
                      />
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0 tabular-nums">
                    {c.redeemRate}%
                  </Badge>
                </div>
              ))
            )}
            {!q.isLoading && (stats?.byCategory.length ?? 0) === 0 && (
              <p className="text-xs text-muted-foreground">暂无类别数据</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">最近兑换</CardTitle>
            <CardDescription className="text-xs">
              最新成功兑换流水
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={recentCols}
              rows={stats?.recentRedeems}
              rowKey={(r) => r.id}
              loading={q.isLoading}
              empty="暂无兑换"
              mobileBreakpoint="sm"
              mobileCard={(r) => (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">
                      {r.categoryName ?? r.categorySlug}
                    </p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      {r.code}
                    </p>
                  </div>
                  <span
                    className="shrink-0 text-[10px] text-muted-foreground"
                    title={formatDateTime(r.createdAt)}
                  >
                    {formatRelative(r.createdAt)}
                  </span>
                </div>
              )}
            />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}

function StatCard({
  title,
  value,
  suffix,
  icon: Icon,
  loading,
  hint,
  trend,
}: {
  title: string;
  value?: number;
  suffix?: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  loading?: boolean;
  hint?: string;
  trend?: number;
}) {
  return (
    <Card className="ui-lift">
      <CardContent className="flex items-start justify-between p-5">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{title}</p>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-16" />
          ) : (
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
              {value ?? 0}
              {suffix ? (
                <span className="ml-0.5 text-sm font-medium text-muted-foreground">
                  {suffix}
                </span>
              ) : null}
            </p>
          )}
          {hint ? (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              {trend != null && trend !== 0 ? (
                trend > 0 ? (
                  <TrendingUp className="size-3 text-emerald-600" />
                ) : (
                  <TrendingDown className="size-3 text-destructive" />
                )
              ) : null}
              {hint}
            </p>
          ) : null}
        </div>
        <div className="rounded-lg bg-secondary/70 p-2 text-muted-foreground">
          <Icon className="size-4" strokeWidth={1.8} />
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({
  label,
  value,
  icon: Icon,
  loading,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-secondary/70 p-2 text-muted-foreground">
          <Icon className="size-3.5" strokeWidth={1.8} />
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-1 h-4 w-12" />
          ) : (
            <p className="text-sm font-medium tabular-nums">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

