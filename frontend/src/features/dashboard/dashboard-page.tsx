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
  RefreshCw,
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
import type {
  CardStatus,
  DashboardStats,
  DashboardTrendRange,
  RedeemRecord,
} from "@/entities/types";
import { CountTo } from "@/shared/components/count-to";
import {
  DataTable,
  type DataTableColumn,
} from "@/shared/components/data-table";
import {
  AreaTrendChart,
  DonutStatusChart,
  HBarCategoryChart,
  RangePills,
} from "@/shared/components/mini-charts";
import { PageContainer } from "@/shared/components/page-container";
import { PageHeader } from "@/shared/components/page-header";
import {
  useDashboardQuery,
  useDashboardRefresh,
  useDashboardTrendQuery,
  useRuntimeMetricsQuery,
} from "@/shared/hooks/use-dashboard";
import { cn } from "@/shared/lib/cn";
import { formatDateTime, formatRelative } from "@/shared/lib/format";

const TREND_RANGES: { id: DashboardTrendRange; label: string }[] = [
  { id: "today", label: "今天" },
  { id: "24h", label: "近 24 小时" },
  { id: "7d", label: "近 7 天" },
  { id: "14d", label: "近 14 天" },
  { id: "30d", label: "近 30 天" },
];

type RuntimeMetrics = NonNullable<
  ReturnType<typeof useRuntimeMetricsQuery>["data"]
>;

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
  | { type: "recent" }
  // 运行时 / 运维（对齐 sub2api：错误、请求、延迟、依赖均可点开）
  | { type: "rtInFlight" }
  | { type: "rtRequests" }
  | { type: "rtLatency" }
  | { type: "rtErrors" }
  | { type: "rtDB" }
  | { type: "rtGo" }
  | { type: "rtRedeems" }
  | { type: "rtLogins" }
  | { type: "rtRedis" };

export function DashboardPage() {
  const q = useDashboardQuery();
  const [rtReady, setRtReady] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setRtReady(true), 800);
    return () => window.clearTimeout(t);
  }, []);
  const rtQ = useRuntimeMetricsQuery(rtReady);

  const [trendRange, setTrendRange] = useState<DashboardTrendRange>("14d");
  const trendQ = useDashboardTrendQuery(trendRange);
  const refreshAll = useDashboardRefresh(trendRange);
  const [refreshing, setRefreshing] = useState(false);

  const [drill, setDrill] = useState<DrillKind | null>(null);

  const stats = q.data;
  const rt = rtQ.data;
  const trendPoints = useMemo(() => {
    const pts = trendQ.data?.points?.length
      ? trendQ.data.points
      : (stats?.trend ?? []);
    return pts.map((p) => ({
      date: p.date,
      label: p.label || p.date.slice(-5),
      count: p.count,
    }));
  }, [trendQ.data, stats?.trend]);
  const delta =
    stats != null ? stats.todayRedeems - stats.yesterdayRedeems : 0;

  async function onRefresh() {
    setRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setRefreshing(false);
    }
  }

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
        description="库存、兑换、趋势与运行时一览"
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={refreshing || q.isFetching}
            onClick={() => void onRefresh()}
          >
            <RefreshCw
              className={cn(
                "size-3.5",
                (refreshing || q.isFetching || trendQ.isFetching) &&
                  "animate-spin",
              )}
            />
            刷新
          </Button>
        }
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
              onClick={() => setDrill({ type: "rtInFlight" })}
            />
            <MetricTile
              label="近 1 分钟请求"
              icon={Activity}
              loading={rtQ.isLoading && !rt}
              value={rt?.requests1m}
              hint={`累计 ${rt?.requestsTotal ?? 0}`}
              onClick={() => setDrill({ type: "rtRequests" })}
            />
            <MetricTile
              label="P95 延迟"
              icon={Timer}
              loading={rtQ.isLoading && !rt}
              value={rt?.latencyP95Ms}
              decimals={1}
              suffix="ms"
              hint={`P50 ${rt?.latencyP50Ms?.toFixed(1) ?? "—"} · P99 ${rt?.latencyP99Ms?.toFixed(1) ?? "—"}`}
              onClick={() => setDrill({ type: "rtLatency" })}
            />
            <MetricTile
              label="错误率"
              icon={Server}
              loading={rtQ.isLoading && !rt}
              value={rt?.errorRatePct}
              decimals={2}
              suffix="%"
              hint={`4xx ${rt?.errors4xx ?? 0} · 5xx ${rt?.errors5xx ?? 0}`}
              onClick={() => setDrill({ type: "rtErrors" })}
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
              onClick={() => setDrill({ type: "rtDB" })}
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
              onClick={() => setDrill({ type: "rtGo" })}
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
              onClick={() => setDrill({ type: "rtRedeems" })}
            />
            <ServicePill
              icon={KeyRound}
              name="管理登录"
              loading={rtQ.isLoading && !rt}
              ok
              detail={rt ? `累计 ${rt.loginsTotal} 次` : "—"}
              onClick={() => setDrill({ type: "rtLogins" })}
            />
          </div>
          {rt ? (
            <button
              type="button"
              className="mt-3 flex w-full items-center justify-between rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-left text-xs transition-colors hover:bg-secondary/40"
              onClick={() => setDrill({ type: "rtRedis" })}
            >
              <span className="text-muted-foreground">
                Redis · 版本 {rt.version} · 运行 {formatUptime(rt.uptimeSec)}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px]",
                  rt.redisOk ? "text-emerald-600" : "text-destructive",
                )}
              >
                {rt.redisOk ? "正常 · 点开明细" : "异常 · 点开明细"}
              </Badge>
            </button>
          ) : null}
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
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-sm">兑换趋势</CardTitle>
                <CardDescription className="text-xs">
                  合计 {trendQ.data?.total ?? trendPoints.reduce((s, p) => s + p.count, 0)} 次
                  {trendQ.data?.bucket === "hour" ? " · 按小时" : " · 按日"}
                </CardDescription>
              </div>
              <RangePills
                value={trendRange}
                options={TREND_RANGES}
                onChange={setTrendRange}
              />
            </div>
          </CardHeader>
          <CardContent>
            {trendQ.isLoading && !trendPoints.length ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <AreaTrendChart
                points={trendPoints}
                height={200}
                onSelect={(i) => {
                  const p = trendPoints[i];
                  if (!p) return;
                  setDrill({
                    type: "trendDay",
                    date: p.date,
                    count: p.count,
                  });
                }}
              />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">状态分布</CardTitle>
            <CardDescription className="text-xs">
              环形占比 · 点选穿透
            </CardDescription>
          </CardHeader>
          <CardContent>
            {q.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <DonutStatusChart
                items={[
                  {
                    key: "unused",
                    label: "未使用",
                    count: stats?.unusedCards ?? 0,
                    color: "rgb(16 185 129 / 0.85)",
                  },
                  {
                    key: "used",
                    label: "已兑换",
                    count: stats?.usedCards ?? 0,
                    color: "rgb(100 116 139 / 0.75)",
                  },
                  {
                    key: "disabled",
                    label: "已禁用",
                    count: stats?.disabledCards ?? 0,
                    color: "rgb(239 68 68 / 0.75)",
                  },
                  {
                    key: "expired",
                    label: "已过期",
                    count: stats?.expiredCards ?? 0,
                    color: "rgb(245 158 11 / 0.8)",
                  },
                ]}
                onSelect={(key) =>
                  setDrill({ type: "status", status: key as CardStatus })
                }
              />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">类别库存对比</CardTitle>
            <CardDescription className="text-xs">
              已兑 / 未用堆叠 · 点选穿透
            </CardDescription>
          </CardHeader>
          <CardContent>
            {q.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <HBarCategoryChart
                items={(stats?.byCategory ?? []).map((c) => ({
                  key: c.slug,
                  label: c.name,
                  unused: c.unused,
                  total: c.total,
                }))}
                onSelect={(slug) => setDrill({ type: "category", slug })}
              />
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
        rt={rt}
        delta={delta}
        onClose={() => setDrill(null)}
      />
    </PageContainer>
  );
}

function DashboardDrillDialog({
  drill,
  stats,
  rt,
  delta,
  onClose,
}: {
  drill: DrillKind | null;
  stats?: DashboardStats;
  rt?: RuntimeMetrics;
  delta: number;
  onClose: () => void;
}) {
  const open = !!drill;
  const meta = drill ? drillMeta(drill, stats, rt, delta) : null;

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
  rt: RuntimeMetrics | undefined,
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
  // 运行时类不依赖 stats
  const rtMeta = runtimeDrillMeta(drill, rt);
  if (rtMeta) return rtMeta;

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

function runtimeDrillMeta(
  drill: DrillKind,
  rt: RuntimeMetrics | undefined,
): ReturnType<typeof drillMeta> | null {
  const isRt =
    drill.type === "rtInFlight" ||
    drill.type === "rtRequests" ||
    drill.type === "rtLatency" ||
    drill.type === "rtErrors" ||
    drill.type === "rtDB" ||
    drill.type === "rtGo" ||
    drill.type === "rtRedeems" ||
    drill.type === "rtLogins" ||
    drill.type === "rtRedis";
  if (!isRt) return null;
  if (!rt) {
    return { title: "运行时指标", empty: "运行时数据加载中，请稍候再点" };
  }

  const okTotal = Math.max(0, rt.requestsTotal - rt.errors4xx - rt.errors5xx);
  const errTotal = rt.errors4xx + rt.errors5xx;
  const redeemAll = rt.redeemsTotal + rt.redeemErrors;
  const redeemOkRate =
    redeemAll > 0
      ? ((rt.redeemsTotal / redeemAll) * 100).toFixed(2)
      : "—";
  const poolUtil =
    rt.dbPoolMax > 0
      ? ((rt.dbPoolAcquired / rt.dbPoolMax) * 100).toFixed(1)
      : "—";
  const qps =
    rt.uptimeSec > 0 ? (rt.requestsTotal / rt.uptimeSec).toFixed(2) : "—";

  switch (drill.type) {
    case "rtInFlight":
      return {
        title: "当前并发",
        description: "此刻正在处理的 HTTP 请求数（不含健康检查）",
        rows: [
          { label: "当前并发", value: String(rt.inFlight) },
          { label: "近 1 分钟请求", value: String(rt.requests1m) },
          { label: "进程累计请求", value: String(rt.requestsTotal) },
          { label: "运行时长", value: formatUptime(rt.uptimeSec) },
        ],
      };
    case "rtRequests":
      return {
        title: "请求量明细",
        description: "进程内计数 · 重启后清零",
        rows: [
          { label: "近 1 分钟", value: String(rt.requests1m) },
          { label: "累计请求", value: String(rt.requestsTotal) },
          { label: "成功约计", value: String(okTotal) },
          { label: "4xx + 5xx", value: String(errTotal) },
          { label: "平均 QPS（累计/运行秒）", value: String(qps) },
          { label: "采样时间", value: formatDateTime(rt.checkedAt) },
        ],
      };
    case "rtLatency":
      return {
        title: "延迟分位",
        description: "最近最多 512 次请求的滑动采样",
        rows: [
          { label: "P50", value: `${rt.latencyP50Ms.toFixed(2)} ms` },
          { label: "P95", value: `${rt.latencyP95Ms.toFixed(2)} ms` },
          { label: "P99", value: `${rt.latencyP99Ms.toFixed(2)} ms` },
          { label: "近 1 分钟请求", value: String(rt.requests1m) },
          { label: "累计请求", value: String(rt.requestsTotal) },
        ],
      };
    case "rtErrors": {
      const errs = rt.recentErrors ?? [];
      return {
        title: "请求错误明细",
        description:
          "进程内最近 4xx/5xx 采样（最多 40 条，重启清空）· 对齐 sub2api 运维错误穿透",
        rows: [
          { label: "错误率", value: `${rt.errorRatePct.toFixed(2)}%` },
          { label: "4xx 累计", value: String(rt.errors4xx) },
          { label: "5xx 累计", value: String(rt.errors5xx) },
          { label: "错误合计", value: String(errTotal) },
          { label: "请求合计", value: String(rt.requestsTotal) },
          { label: "成功约计", value: String(okTotal) },
        ],
        list: errs.map((e, i) => ({
          id: `${e.at}-${e.path}-${i}`,
          title: `${e.status} ${e.method}`,
          sub: e.path,
          right: `${e.latencyMs.toFixed(1)}ms · ${formatRelative(e.at)}`,
        })),
        empty: errs.length ? undefined : "暂无错误采样（或进程刚启动）",
        links: [{ to: "/admin/audit", label: "打开审计日志" }],
      };
    }
    case "rtDB":
      return {
        title: "PostgreSQL 连接池",
        description: "pgx 连接池实时状态",
        rows: [
          { label: "已占用", value: String(rt.dbPoolAcquired) },
          { label: "空闲", value: String(rt.dbPoolIdle) },
          { label: "当前连接", value: String(rt.dbPoolTotal) },
          { label: "上限 Max", value: String(rt.dbPoolMax) },
          { label: "占用率", value: `${poolUtil}%` },
        ],
      };
    case "rtGo":
      return {
        title: "Go 运行时",
        description: `版本 ${rt.version} · 模式 ${rt.updateMode}`,
        rows: [
          { label: "协程数", value: String(rt.goRoutines) },
          { label: "堆分配", value: `${rt.memAllocMB.toFixed(2)} MB` },
          { label: "运行时长", value: formatUptime(rt.uptimeSec) },
          { label: "采样时间", value: formatDateTime(rt.checkedAt) },
        ],
        links: [{ to: "/admin/settings", label: "系统设置 / 版本" }],
      };
    case "rtRedeems":
      return {
        title: "兑换吞吐",
        description: "进程内兑换成功 / 失败计数",
        rows: [
          { label: "成功", value: String(rt.redeemsTotal) },
          { label: "失败", value: String(rt.redeemErrors) },
          { label: "合计", value: String(redeemAll) },
          { label: "成功率", value: redeemOkRate === "—" ? "—" : `${redeemOkRate}%` },
        ],
        links: [{ to: "/admin/redeems", label: "打开兑换记录" }],
      };
    case "rtLogins":
      return {
        title: "管理登录",
        description: "进程内累计登录次数（重启清零）",
        rows: [
          { label: "累计登录", value: String(rt.loginsTotal) },
          { label: "运行时长", value: formatUptime(rt.uptimeSec) },
        ],
        links: [{ to: "/admin/audit", label: "打开审计日志" }],
      };
    case "rtRedis":
      return {
        title: "Redis / 进程概况",
        description: "依赖健康与版本信息",
        rows: [
          { label: "Redis", value: rt.redisOk ? "正常" : "异常 / 未连接" },
          { label: "版本", value: rt.version },
          { label: "更新模式", value: rt.updateMode },
          { label: "运行时长", value: formatUptime(rt.uptimeSec) },
          { label: "协程", value: String(rt.goRoutines) },
          { label: "内存", value: `${rt.memAllocMB.toFixed(2)} MB` },
          { label: "采样时间", value: formatDateTime(rt.checkedAt) },
        ],
      };
    default:
      return null;
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
  onClick,
}: {
  label: string;
  value?: number;
  decimals?: number;
  suffix?: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  loading?: boolean;
  hint?: string;
  onClick?: () => void;
}) {
  const interactive = !!onClick && !loading;
  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-secondary/25 px-3 py-3 transition-colors",
        interactive
          ? "cursor-pointer hover:border-primary/30 hover:bg-secondary/45"
          : "hover:bg-secondary/40",
      )}
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
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  name: string;
  detail: string;
  ok?: boolean;
  loading?: boolean;
  onClick?: () => void;
}) {
  const interactive = !!onClick && !loading;
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-border/50 bg-background/60 px-3 py-2.5 transition-colors",
        interactive && "cursor-pointer hover:border-primary/30 hover:bg-secondary/30",
      )}
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

