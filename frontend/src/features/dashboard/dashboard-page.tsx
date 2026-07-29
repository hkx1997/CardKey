import {
  Activity,
  CheckCircle2,
  Cpu,
  Database,
  ExternalLink,
  FolderTree,
  Gauge,
  KeyRound,
  Percent,
  Server,
  Ticket,
  Timer,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { CardStatus, DashboardStats, RedeemRecord } from "@/entities/types";
import { CountTo } from "@/shared/components/count-to";
import {
  DataTable,
  type DataTableColumn,
} from "@/shared/components/data-table";
import { PageContainer } from "@/shared/components/page-container";
import { PageHeader } from "@/shared/components/page-header";
import {
  useDashboardQuery,
  useRuntimeMetricsQuery,
} from "@/shared/hooks/use-dashboard";
import { CategoryIconView } from "@/shared/lib/category-icons";
import { cn } from "@/shared/lib/cn";
import { formatDateTime, formatRelative } from "@/shared/lib/format";
import { CardStatusBadge } from "@/shared/lib/status";

type DrillKind =
  | { type: "totalCards" }
  | { type: "todayRedeems" }
  | { type: "weekRedeems" }
  | { type: "redeemRate" }
  | { type: "status"; status: CardStatus }
  | { type: "category"; slug: string }
  | { type: "categories" }
  | { type: "apiKeys" }
  | { type: "stock" }
  | { type: "trendDay"; date: string; count: number }
  | { type: "recent" };

export function DashboardPage() {
  const q = useDashboardQuery();
  const [rtReady, setRtReady] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setRtReady(true), 1200);
    return () => window.clearTimeout(t);
  }, []);
  const rtQ = useRuntimeMetricsQuery(rtReady);

  const [drill, setDrill] = useState<DrillKind | null>(null);

  const stats = q.data;
  const rt = rtQ.data;
  const maxTrend = Math.max(1, ...(stats?.trend.map((t) => t.count) ?? [1]));
  const delta =
    stats != null ? stats.todayRedeems - stats.yesterdayRedeems : 0;

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
        description="库存、兑换与类别健康度一览 · 点击卡片可查看明细"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="卡密总量"
          value={stats?.totalCards}
          icon={Ticket}
          loading={q.isLoading}
          hint={`未用 ${stats?.unusedCards ?? "—"} · 已兑 ${stats?.usedCards ?? "—"}`}
          onClick={() => setDrill({ type: "totalCards" })}
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
          onClick={() => setDrill({ type: "todayRedeems" })}
        />
        <StatCard
          title="近 7 日兑换"
          value={stats?.weekRedeems}
          icon={Activity}
          loading={q.isLoading}
          hint={`累计 ${stats?.totalRedeems ?? 0} 次`}
          onClick={() => setDrill({ type: "weekRedeems" })}
        />
        <StatCard
          title="整体核销率"
          value={stats?.redeemRate}
          suffix="%"
          icon={Percent}
          loading={q.isLoading}
          hint={`禁用 ${stats?.disabledCards ?? 0} · 过期 ${stats?.expiredCards ?? 0}`}
          onClick={() => setDrill({ type: "redeemRate" })}
        />
      </div>

      <Card className="fade-in-delay-1 overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Gauge className="size-4 text-muted-foreground" />
                流量与运行时
              </CardTitle>
              <CardDescription className="text-xs">
                并发 · 近 1 分钟 QPS · 延迟分位 · 依赖健康（约 5s 刷新）
              </CardDescription>
            </div>
            {rt ? (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px]",
                  rt.redisOk ? "text-emerald-600" : "text-destructive",
                )}
              >
                Redis {rt.redisOk ? "正常" : "异常"} · 运行{" "}
                {formatUptime(rt.uptimeSec)}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile
              label="当前并发"
              icon={Zap}
              loading={rtQ.isLoading && !rt}
              value={rt?.inFlight}
              hint="处理中的 HTTP 请求"
            />
            <MetricTile
              label="近 1 分钟请求"
              icon={Activity}
              loading={rtQ.isLoading && !rt}
              value={rt?.requests1m}
              hint={`累计 ${rt?.requestsTotal ?? 0}`}
            />
            <MetricTile
              label="P95 延迟"
              icon={Timer}
              loading={rtQ.isLoading && !rt}
              value={rt?.latencyP95Ms}
              decimals={1}
              suffix="ms"
              hint={`P50 ${rt?.latencyP50Ms?.toFixed(1) ?? "—"} · P99 ${rt?.latencyP99Ms?.toFixed(1) ?? "—"}`}
            />
            <MetricTile
              label="错误率"
              icon={Server}
              loading={rtQ.isLoading && !rt}
              value={rt?.errorRatePct}
              decimals={2}
              suffix="%"
              hint={`4xx ${rt?.errors4xx ?? 0} · 5xx ${rt?.errors5xx ?? 0}`}
            />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ServicePill
              icon={Database}
              name="PostgreSQL 连接池"
              loading={rtQ.isLoading && !rt}
              ok={(rt?.dbPoolMax ?? 0) > 0}
              detail={
                rt
                  ? `使用 ${rt.dbPoolAcquired}/${rt.dbPoolMax} · 空闲 ${rt.dbPoolIdle}`
                  : "—"
              }
            />
            <ServicePill
              icon={Cpu}
              name="Go 运行时"
              loading={rtQ.isLoading && !rt}
              ok
              detail={
                rt
                  ? `协程 ${rt.goRoutines} · 内存 ${rt.memAllocMB.toFixed(1)} MB`
                  : "—"
              }
            />
            <ServicePill
              icon={Ticket}
              name="兑换吞吐"
              loading={rtQ.isLoading && !rt}
              ok
              detail={
                rt
                  ? `成功 ${rt.redeemsTotal} · 失败 ${rt.redeemErrors}`
                  : "—"
              }
            />
            <ServicePill
              icon={KeyRound}
              name="管理登录"
              loading={rtQ.isLoading && !rt}
              ok
              detail={rt ? `累计 ${rt.loginsTotal} 次` : "—"}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <MiniStat
          label="启用类别"
          value={`${stats?.enabledCategories ?? 0} / ${stats?.totalCategories ?? 0}`}
          icon={FolderTree}
          loading={q.isLoading}
          onClick={() => setDrill({ type: "categories" })}
        />
        <MiniStat
          label="有效 API Key"
          value={String(stats?.activeApiKeys ?? 0)}
          icon={KeyRound}
          loading={q.isLoading}
          onClick={() => setDrill({ type: "apiKeys" })}
        />
        <MiniStat
          label="库存健康"
          value={
            stats ? (stats.unusedCards > 0 ? "充足" : "需补货") : "—"
          }
          icon={CheckCircle2}
          loading={q.isLoading}
          onClick={() => setDrill({ type: "stock" })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">近 14 日兑换趋势</CardTitle>
            <CardDescription className="text-xs">
              按日统计 · 点击柱状可看当日明细
            </CardDescription>
          </CardHeader>
          <CardContent>
            {q.isLoading ? (
              <Skeleton className="h-44 w-full" />
            ) : (
              <div className="flex h-44 items-end gap-1">
                {stats?.trend.map((t) => (
                  <button
                    key={t.date}
                    type="button"
                    className="group flex flex-1 flex-col items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={`${t.date}: ${t.count}（点击明细）`}
                    onClick={() =>
                      setDrill({
                        type: "trendDay",
                        date: t.date,
                        count: t.count,
                      })
                    }
                  >
                    <span className="text-[9px] tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                      {t.count}
                    </span>
                    <div
                      className="w-full max-w-6 rounded-t-sm bg-primary/75 transition-all duration-300 group-hover:bg-primary group-hover:shadow-sm"
                      style={{
                        height: `${Math.max(6, (t.count / maxTrend) * 100)}%`,
                      }}
                    />
                    <span className="text-[9px] text-muted-foreground">
                      {t.date.slice(5)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">状态分布</CardTitle>
            <CardDescription className="text-xs">
              点击状态可穿透到卡密列表
            </CardDescription>
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
                  <button
                    key={row.status}
                    type="button"
                    className="block w-full space-y-1 rounded-md text-left outline-none transition-colors hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() =>
                      setDrill({ type: "status", status: row.status })
                    }
                  >
                    <div className="flex items-center justify-between px-1 text-xs">
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
                  </button>
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
              点击类别查看明细并可跳转卡密
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {q.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              stats?.byCategory.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg bg-secondary/40 px-3 py-2.5 text-left transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setDrill({ type: "category", slug: c.slug })}
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
                </button>
              ))
            )}
            {!q.isLoading && (stats?.byCategory.length ?? 0) === 0 && (
              <p className="text-xs text-muted-foreground">暂无类别数据</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm">最近兑换</CardTitle>
                <CardDescription className="text-xs">
                  最新成功兑换流水
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => setDrill({ type: "recent" })}
              >
                明细
              </Button>
            </div>
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

      <DashboardDrillDialog
        drill={drill}
        stats={stats}
        delta={delta}
        onClose={() => setDrill(null)}
      />
    </PageContainer>
  );
}

function DashboardDrillDialog({
  drill,
  stats,
  delta,
  onClose,
}: {
  drill: DrillKind | null;
  stats?: DashboardStats;
  delta: number;
  onClose: () => void;
}) {
  const open = !!drill;
  const meta = drill ? drillMeta(drill, stats, delta) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{meta?.title ?? "明细"}</DialogTitle>
          {meta?.description ? (
            <DialogDescription>{meta.description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="dialog-body space-y-3 text-sm">
          {meta?.rows?.length ? (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <tbody>
                  {meta.rows.map((r) => (
                    <tr
                      key={r.label}
                      className="border-t border-border/60 first:border-t-0"
                    >
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {r.label}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                        {r.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {meta?.list?.length ? (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-border/70 p-2">
              {meta.list.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-secondary/40"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.title}</p>
                    {item.sub ? (
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        {item.sub}
                      </p>
                    ) : null}
                  </div>
                  {item.right ? (
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {item.right}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {meta?.empty ? (
            <p className="text-xs text-muted-foreground">{meta.empty}</p>
          ) : null}

          {meta?.links?.length ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {meta.links.map((l) => (
                <Button key={l.to} variant="outline" size="sm" asChild>
                  <Link to={l.to} onClick={onClose}>
                    <ExternalLink className="size-3.5" />
                    {l.label}
                  </Link>
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function drillMeta(
  drill: DrillKind,
  stats: DashboardStats | undefined,
  delta: number,
): {
  title: string;
  description?: string;
  rows?: { label: string; value: string }[];
  list?: {
    id: string;
    title: string;
    sub?: string;
    right?: string;
  }[];
  links?: { to: string; label: string }[];
  empty?: string;
} {
  if (!stats) {
    return { title: "加载中", empty: "暂无数据" };
  }

  switch (drill.type) {
    case "totalCards":
      return {
        title: "卡密总量明细",
        description: "按状态拆分的当前库存",
        rows: [
          { label: "总量", value: String(stats.totalCards) },
          { label: "未使用", value: String(stats.unusedCards) },
          { label: "已兑换", value: String(stats.usedCards) },
          { label: "已禁用", value: String(stats.disabledCards) },
          { label: "已过期", value: String(stats.expiredCards) },
        ],
        links: [
          { to: "/admin/cards", label: "打开卡密管理" },
          { to: "/admin/cards?status=unused", label: "仅看未使用" },
        ],
      };
    case "todayRedeems":
      return {
        title: "今日兑换明细",
        description: "与昨日对比及累计",
        rows: [
          { label: "今日", value: String(stats.todayRedeems) },
          { label: "昨日", value: String(stats.yesterdayRedeems) },
          {
            label: "较昨日",
            value: delta === 0 ? "持平" : delta > 0 ? `+${delta}` : String(delta),
          },
          { label: "近 7 日", value: String(stats.weekRedeems) },
          { label: "历史累计", value: String(stats.totalRedeems) },
        ],
        links: [{ to: "/admin/redeems", label: "打开兑换记录" }],
      };
    case "weekRedeems": {
      const last7 = stats.trend.slice(-7);
      return {
        title: "近 7 日兑换明细",
        description: "按日成功兑换次数",
        rows: [
          { label: "近 7 日合计", value: String(stats.weekRedeems) },
          { label: "历史累计", value: String(stats.totalRedeems) },
          ...last7.map((t) => ({
            label: t.date,
            value: String(t.count),
          })),
        ],
        links: [{ to: "/admin/redeems", label: "打开兑换记录" }],
      };
    }
    case "redeemRate":
      return {
        title: "核销率明细",
        description: "已兑 / 总量（不含禁用、过期策略以服务端为准）",
        rows: [
          { label: "核销率", value: `${stats.redeemRate}%` },
          { label: "已兑换", value: String(stats.usedCards) },
          { label: "未使用", value: String(stats.unusedCards) },
          { label: "总量", value: String(stats.totalCards) },
          { label: "禁用", value: String(stats.disabledCards) },
          { label: "过期", value: String(stats.expiredCards) },
        ],
        links: [
          { to: "/admin/cards?status=used", label: "已兑换卡密" },
          { to: "/admin/cards?status=unused", label: "未使用卡密" },
        ],
      };
    case "status": {
      const row = stats.statusBreakdown.find((s) => s.status === drill.status);
      const pct =
        stats.totalCards && row
          ? Math.round((row.count / stats.totalCards) * 100)
          : 0;
      const labels: Record<CardStatus, string> = {
        unused: "未使用",
        used: "已兑换",
        disabled: "已禁用",
        expired: "已过期",
      };
      return {
        title: `状态 · ${labels[drill.status]}`,
        description: "当前快照数量",
        rows: [
          { label: "数量", value: String(row?.count ?? 0) },
          { label: "占比", value: `${pct}%` },
          { label: "卡密总量", value: String(stats.totalCards) },
        ],
        links: [
          {
            to: `/admin/cards?status=${drill.status}`,
            label: "在卡密管理中查看",
          },
        ],
      };
    }
    case "category": {
      const c = stats.byCategory.find((x) => x.slug === drill.slug);
      if (!c) return { title: "类别", empty: "未找到该类别" };
      return {
        title: c.name,
        description: `slug · ${c.slug}`,
        rows: [
          { label: "未使用", value: String(c.unused) },
          { label: "已兑换", value: String(c.used) },
          { label: "总量", value: String(c.total) },
          { label: "核销率", value: `${c.redeemRate}%` },
        ],
        links: [
          {
            to: `/admin/cards?category=${encodeURIComponent(c.slug)}`,
            label: "查看该类卡密",
          },
          {
            to: `/admin/cards?category=${encodeURIComponent(c.slug)}&status=unused`,
            label: "仅未使用",
          },
        ],
      };
    }
    case "categories":
      return {
        title: "类别概览",
        description: "启用 / 全部",
        rows: [
          { label: "启用中", value: String(stats.enabledCategories) },
          { label: "全部类别", value: String(stats.totalCategories) },
        ],
        list: stats.byCategory.map((c) => ({
          id: c.slug,
          title: c.name,
          sub: c.slug,
          right: `${c.unused}/${c.total}`,
        })),
        links: [{ to: "/admin/categories", label: "打开类别管理" }],
        empty: stats.byCategory.length ? undefined : "暂无类别",
      };
    case "apiKeys":
      return {
        title: "API 密钥",
        description: "当前有效（未吊销）密钥数量",
        rows: [
          { label: "有效密钥", value: String(stats.activeApiKeys) },
        ],
        links: [{ to: "/admin/api-keys", label: "打开 API 密钥" }],
      };
    case "stock":
      return {
        title: "库存健康",
        description:
          stats.unusedCards > 0
            ? "仍有可兑换库存"
            : "可兑库存为 0，建议补货",
        rows: [
          { label: "未使用", value: String(stats.unusedCards) },
          { label: "已兑换", value: String(stats.usedCards) },
          { label: "总量", value: String(stats.totalCards) },
        ],
        list: stats.byCategory
          .filter((c) => c.unused <= 0 && c.total > 0)
          .map((c) => ({
            id: c.slug,
            title: c.name,
            sub: "可兑库存为 0",
            right: `${c.unused}/${c.total}`,
          })),
        links: [
          { to: "/admin/cards?status=unused", label: "未使用卡密" },
          { to: "/admin/cards/import", label: "批量导入" },
        ],
        empty:
          stats.byCategory.some((c) => c.unused <= 0 && c.total > 0)
            ? undefined
            : "各类别库存正常",
      };
    case "trendDay":
      return {
        title: `兑换 · ${drill.date}`,
        description: "当日成功兑换次数（趋势统计）",
        rows: [
          { label: "日期", value: drill.date },
          { label: "成功次数", value: String(drill.count) },
          { label: "近 7 日合计", value: String(stats.weekRedeems) },
        ],
        links: [{ to: "/admin/redeems", label: "打开兑换记录" }],
      };
    case "recent":
      return {
        title: "最近兑换明细",
        description: "仪表盘缓存的最新流水",
        list: (stats.recentRedeems ?? []).map((r) => ({
          id: r.id,
          title: r.categoryName ?? r.categorySlug ?? "—",
          sub: r.code,
          right: formatRelative(r.createdAt),
        })),
        links: [{ to: "/admin/redeems", label: "全部兑换记录" }],
        empty: stats.recentRedeems?.length ? undefined : "暂无兑换",
      };
    default:
      return { title: "明细" };
  }
}

function StatCard({
  title,
  value,
  suffix,
  icon: Icon,
  loading,
  hint,
  trend,
  onClick,
}: {
  title: string;
  value?: number;
  suffix?: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  loading?: boolean;
  hint?: string;
  trend?: number;
  onClick?: () => void;
}) {
  const interactive = !!onClick && !loading;
  return (
    <Card
      className={cn(
        "ui-lift",
        interactive &&
          "cursor-pointer transition-colors hover:border-primary/30 focus-within:ring-2 focus-within:ring-ring",
      )}
    >
      <CardContent
        className="flex items-start justify-between p-5"
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={interactive ? onClick : undefined}
        onKeyDown={
          interactive
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClick?.();
                }
              }
            : undefined
        }
      >
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{title}</p>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-16" />
          ) : (
            <p className="mt-1 text-2xl font-semibold tracking-tight">
              <CountTo value={value ?? 0} suffix={suffix} />
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
          {interactive ? (
            <p className="mt-1 text-[10px] text-primary/80">点击查看明细</p>
          ) : null}
        </div>
        <div className="rounded-lg bg-secondary/70 p-2 text-muted-foreground">
          <Icon className="size-4" strokeWidth={1.8} />
        </div>
      </CardContent>
    </Card>
  );
}

function formatUptime(sec: number) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function MetricTile({
  label,
  value,
  decimals,
  suffix,
  icon: Icon,
  loading,
  hint,
}: {
  label: string;
  value?: number;
  decimals?: number;
  suffix?: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  loading?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/25 px-3 py-3 transition-colors hover:bg-secondary/40">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <Icon className="size-3.5 text-muted-foreground" strokeWidth={1.8} />
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-6 w-14" />
      ) : (
        <p className="mt-1 text-xl font-semibold tracking-tight">
          <CountTo
            value={value ?? 0}
            decimals={decimals ?? 0}
            suffix={suffix}
            duration={700}
          />
        </p>
      )}
      {hint ? (
        <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function ServicePill({
  icon: Icon,
  name,
  detail,
  ok,
  loading,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  name: string;
  detail: string;
  ok?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-background/60 px-3 py-2.5">
      <div
        className={cn(
          "mt-0.5 rounded-md p-1.5",
          ok === false
            ? "bg-destructive/10 text-destructive"
            : "bg-secondary text-muted-foreground",
        )}
      >
        <Icon className="size-3.5" strokeWidth={1.8} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium">{name}</p>
        {loading ? (
          <Skeleton className="mt-1 h-3 w-24" />
        ) : (
          <p className="mt-0.5 text-[10px] text-muted-foreground">{detail}</p>
        )}
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  icon: Icon,
  loading,
  onClick,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  loading?: boolean;
  onClick?: () => void;
}) {
  const interactive = !!onClick && !loading;
  return (
    <Card
      className={cn(
        interactive &&
          "cursor-pointer transition-colors hover:border-primary/30",
      )}
    >
      <CardContent
        className="flex items-center gap-3 p-4"
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={interactive ? onClick : undefined}
        onKeyDown={
          interactive
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClick?.();
                }
              }
            : undefined
        }
      >
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

