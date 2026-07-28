import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Download,
  Loader2,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import type { PublicCategory, RedeemResult } from "@/entities/types";
import { CardContentView } from "@/shared/components/card-content-view";
import { RichTextView } from "@/shared/components/rich-text-view";
import { SiteBrand } from "@/shared/components/site-brand";
import { TaskProgress } from "@/shared/components/task-progress";
import { ThemeToggleButton } from "@/shared/components/theme-toggle-button";
import {
  resetTurnstile,
  TurnstileWidget,
} from "@/shared/components/turnstile-widget";
import {
  BATCH_REDEEM_MAX,
  PUBLIC_STOCK_POLL_MS,
  useBatchRedeemMutation,
  usePublicCategoryStockQuery,
  usePublicConfigQuery,
  useRedeemMutation,
} from "@/shared/hooks/use-public-config";
import {
  cardTypeLabel,
  downloadRedeemContent,
} from "@/shared/lib/card-content";
import { CategoryIconView } from "@/shared/lib/category-icons";
import { cn } from "@/shared/lib/cn";
import { parseRedeemCodes } from "@/shared/lib/redeem-codes";
import {
  buildRedeemZip,
  downloadBlob,
  type BatchRedeemItem,
} from "@/shared/lib/redeem-zip";
import { isEmptyHtml } from "@/shared/lib/sanitize-html";

export function RedeemPage() {
  const [category, setCategory] = useState("");
  const [raw, setRaw] = useState("");
  const [singleResult, setSingleResult] = useState<RedeemResult | null>(null);
  const [batchItems, setBatchItems] = useState<BatchRedeemItem[] | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const stockPollMs = PUBLIC_STOCK_POLL_MS;
  const stockPollSec = Math.max(1, Math.round(stockPollMs / 1000));

  const configQ = usePublicConfigQuery();
  const stockQ = usePublicCategoryStockQuery({ intervalMs: stockPollMs });
  const redeemM = useRedeemMutation();
  const batchM = useBatchRedeemMutation();

  /** 距下次库存刷新的剩余秒数（动态倒计时） */
  const [stockCountdown, setStockCountdown] = useState(stockPollSec);
  useEffect(() => {
    const tick = () => {
      if (!stockQ.dataUpdatedAt) {
        setStockCountdown(stockPollSec);
        return;
      }
      const elapsed = Date.now() - stockQ.dataUpdatedAt;
      const leftMs = Math.max(0, stockPollMs - elapsed);
      setStockCountdown(Math.max(0, Math.ceil(leftMs / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [stockQ.dataUpdatedAt, stockPollMs, stockPollSec]);

  const cfg = configQ.data;
  const stockMap = useMemo(() => {
    const m = new Map<string, number>();
    // 配置不再携带可靠库存（可能为 -1）；仅 stock 接口为准
    for (const c of cfg?.categories ?? []) {
      if (typeof c.unusedCount === "number" && c.unusedCount >= 0) {
        m.set(c.slug, c.unusedCount);
      }
    }
    for (const c of stockQ.data?.categories ?? []) {
      m.set(c.slug, c.unusedCount);
    }
    return m;
  }, [cfg?.categories, stockQ.data?.categories]);

  const categories = useMemo(() => {
    const list = cfg?.categories ?? [];
    return list.map((c) => ({
      ...c,
      unusedCount: stockMap.has(c.slug)
        ? stockMap.get(c.slug)!
        : typeof c.unusedCount === "number" && c.unusedCount >= 0
          ? c.unusedCount
          : 0,
    }));
  }, [cfg?.categories, stockMap]);

  const tabCount = Math.max(1, cfg?.redeemTabVisibleCount ?? 4);
  const primaryTabs = categories.slice(0, tabCount);
  const moreTabs = categories.slice(tabCount);

  const codes = useMemo(() => parseRedeemCodes(raw), [raw]);

  // 标题 / Favicon 由全局 DocumentMeta 统一处理

  useEffect(() => {
    if (!categories.length) return;
    if (!category || !categories.some((c) => c.slug === category)) {
      setCategory(categories[0]!.slug);
    }
  }, [categories, category]);

  const selected = useMemo(
    () => categories.find((c) => c.slug === category),
    [categories, category],
  );
  const inMore = moreTabs.some((c) => c.slug === category);

  const busy = redeemM.isPending || batchM.isPending || exporting;

  function selectCategory(slug: string) {
    setCategory(slug);
    setSingleResult(null);
    setBatchItems(null);
    setProgress(null);
  }

  function clearResults() {
    setSingleResult(null);
    setBatchItems(null);
    setProgress(null);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!category) {
      toast.error("请选择类别");
      return;
    }
    if (codes.length === 0) {
      toast.error("请输入兑换编码（一行一个）");
      return;
    }
    const needCaptcha = !!cfg?.captchaEnabled && !!cfg.captchaSiteKey;
    if (needCaptcha && !captchaToken) {
      toast.error("请先完成人机验证");
      return;
    }

    clearResults();
    const token = captchaToken ?? undefined;

    // 单条：走原有单次兑换体验
    if (codes.length === 1) {
      const code = codes[0]!;
      redeemM.mutate(
        { category, code, captchaToken: token },
        {
          onSuccess: (data) => {
            setSingleResult(data);
            toast.success(cfg?.redeemSuccessHint || "兑换成功");
            setCaptchaToken(null);
            resetTurnstile();
          },
          onError: () => {
            setSingleResult(null);
            setCaptchaToken(null);
            resetTurnstile();
          },
        },
      );
      return;
    }

    // 多条：批量（首条带验证码；若服务端要求每条验证，需关闭批量或接 API Key）
    setProgress({ done: 0, total: codes.length });
    batchM.mutate(
      {
        category,
        codes,
        captchaToken: token,
        onProgress: (done, total) => setProgress({ done, total }),
      },
      {
        onSuccess: (items) => {
          setBatchItems(items);
          setProgress(null);
          const ok = items.filter((i) => i.ok).length;
          const fail = items.length - ok;
          if (fail === 0) toast.success(`全部兑换完成 · ${ok} 条`);
          else if (ok === 0) toast.error(`全部失败 · ${fail} 条`);
          else toast.message(`完成：成功 ${ok} · 失败 ${fail}`);
          setCaptchaToken(null);
          resetTurnstile();
        },
        onError: () => {
          setProgress(null);
          toast.error("批量兑换中断");
          setCaptchaToken(null);
          resetTurnstile();
        },
      },
    );
  }

  async function exportZip() {
    if (!batchItems?.length) return;
    setExporting(true);
    try {
      const stamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, "-");
      const blob = await buildRedeemZip(batchItems, {
        folderName: `redeem-${category || "batch"}`,
      });
      downloadBlob(blob, `cardkey-redeem-${stamp}.zip`);
      toast.success("ZIP 已开始下载");
    } catch {
      toast.error("导出 ZIP 失败");
    } finally {
      setExporting(false);
    }
  }

  const siteName = cfg?.siteName ?? "CardKey";
  const title = cfg?.redeemTitle ?? "卡密兑换";
  const subtitle = cfg?.redeemSubtitle ?? "";
  const btnText = cfg?.redeemButtonText || "立即兑换";
  const placeholder =
    cfg?.redeemPlaceholder ||
    (selected
      ? `${selected.codePrefix}-XXXX-XXXX-XXXX-XXXX`
      : "兑换编码");

  const batchOk = batchItems?.filter((i) => i.ok).length ?? 0;
  const batchFail = batchItems ? batchItems.length - batchOk : 0;

  if (configQ.isLoading) {
    return (
      <div className="flex min-h-dvh flex-col bg-background">
        <header className="border-b border-border/50">
          <div className="mx-auto flex h-14 w-full max-w-3xl items-center px-5">
            <Skeleton className="h-7 w-28 rounded-md" />
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-5 py-10 sm:py-14">
          <div className="space-y-3 text-center">
            <Skeleton className="mx-auto h-9 w-48 rounded-lg" />
            <Skeleton className="mx-auto h-4 w-64 max-w-full rounded-md" />
          </div>
          <div className="rounded-2xl border border-border/70 bg-card p-6 sm:p-8">
            <div className="mb-6 flex flex-wrap justify-center gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-24 rounded-full" />
              ))}
            </div>
            <Skeleton className="mx-auto h-[120px] w-full max-w-md rounded-lg" />
            <Skeleton className="mx-auto mt-3 h-11 w-full max-w-md rounded-lg" />
          </div>
        </main>
      </div>
    );
  }

  if (configQ.isError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-sm text-muted-foreground">无法加载站点配置</p>
        <Button size="sm" onClick={() => void configQ.refetch()}>
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className="redeem-shell flex min-h-dvh flex-col bg-background">
      <RedeemHeader
        siteName={siteName}
        logo={cfg?.siteLogo}
        showDocs={!!cfg?.showApiDocsEntry}
      />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-10 sm:gap-7 sm:py-14">
        <div className="fade-in text-center">
          <h1 className="redeem-title text-3xl font-semibold sm:text-[2.5rem] sm:leading-tight">
            {title}
          </h1>
          {subtitle ? (
            <p className="mx-auto mt-3.5 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
              {subtitle}
            </p>
          ) : null}
        </div>

        <section
          aria-label="兑换"
          className="fade-in fade-in-delay-1 redeem-card w-full rounded-2xl p-6 sm:p-8"
        >
          <div className="mb-6">
            {categories.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground">
                暂无可用类别
              </p>
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                {primaryTabs.map((c, i) => (
                  <CategoryTab
                    key={c.slug}
                    cat={c}
                    stock={c.unusedCount ?? 0}
                    active={category === c.slug}
                    onClick={() => selectCategory(c.slug)}
                    stagger={i}
                  />
                ))}
                {moreTabs.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "tab-pill interactive-press inline-flex h-10 items-center gap-1 rounded-full px-3.5 text-sm",
                          inMore
                            ? "is-active bg-primary text-primary-foreground shadow-sm"
                            : "bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground",
                        )}
                      >
                        更多
                        <ChevronDown className="size-3.5 opacity-70" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center" className="w-52">
                      {moreTabs.map((c) => (
                        <DropdownMenuItem
                          key={c.slug}
                          onClick={() => selectCategory(c.slug)}
                          className={cn(
                            "justify-between gap-2",
                            category === c.slug && "bg-accent",
                          )}
                        >
                          <span className="inline-flex min-w-0 items-center gap-2">
                            {/* 图标本身 20px，无额外大底托 */}
                            <CategoryIconView icon={c.icon} size={20} />
                            <span className="truncate">{c.name}</span>
                          </span>
                          <StockBadge
                            count={c.unusedCount ?? 0}
                            active={category === c.slug}
                            compact
                          />
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )}
            {categories.length > 0 ? (
              <p className="mt-3 text-center text-[11px] text-muted-foreground">
                {selected ? (
                  <>
                    当前「{selected.name}」剩余{" "}
                    <StockCount
                      value={selected.unusedCount ?? 0}
                      empty={(selected.unusedCount ?? 0) <= 0}
                    />{" "}
                    张
                  </>
                ) : (
                  "选择类别查看库存"
                )}
                <span className="mx-1.5 opacity-40">·</span>
                {stockQ.isFetching && !stockQ.isLoading ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin" />
                    刷新中
                  </span>
                ) : (
                  <>
                    <span className="tabular-nums font-medium text-foreground">
                      {stockCountdown}
                    </span>{" "}
                    秒后刷新
                  </>
                )}
              </p>
            ) : null}
          </div>

          <form onSubmit={onSubmit} className="mx-auto max-w-md space-y-3.5">
            <div className="redeem-field-focus rounded-xl">
              <Textarea
                autoComplete="off"
                spellCheck={false}
                placeholder={`一行一个兑换编码，支持单个或多个\n${placeholder}`}
                className="min-h-[128px] rounded-xl border-border/60 bg-background/70 font-mono text-sm leading-relaxed shadow-none sm:min-h-[148px]"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                disabled={busy || !category}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {codes.length <= 1
                  ? codes.length === 1
                    ? "1 条编码"
                    : "请输入编码"
                  : `${codes.length} 条编码（已去重，单次最多 ${BATCH_REDEEM_MAX} 条）`}
              </span>
            </div>
            {cfg?.captchaEnabled && cfg.captchaSiteKey ? (
              <div className="flex justify-center">
                <TurnstileWidget
                  siteKey={cfg.captchaSiteKey}
                  onToken={setCaptchaToken}
                />
              </div>
            ) : null}
            {(selected?.slug === "vip" || selected?.slug === "cdk") && (
              <p className="text-center text-[11px] text-muted-foreground">
                <button
                  type="button"
                  className="font-mono underline-offset-2 hover:underline"
                  disabled={busy}
                  onClick={() => {
                    const demo =
                      selected.slug === "vip"
                        ? "VIP-DEMO-7K3M-9P2X-W4QH"
                        : "CDK-DEMO-A2B3-C4D5-E6F7";
                    setRaw((prev) =>
                      prev.trim() ? `${prev.trim()}\n${demo}` : demo,
                    );
                  }}
                >
                  {selected.slug === "vip"
                    ? "VIP-DEMO-7K3M-9P2X-W4QH"
                    : "CDK-DEMO-A2B3-C4D5-E6F7"}
                </button>
              </p>
            )}
            <Button
              type="submit"
              size="lg"
              className="interactive-press h-12 w-full text-[15px] font-medium shadow-sm"
              disabled={
                busy ||
                !category ||
                codes.length === 0 ||
                (!!cfg?.captchaEnabled &&
                  !!cfg.captchaSiteKey &&
                  !captchaToken)
              }
            >
              {redeemM.isPending || batchM.isPending ? (
                <>
                  <Loader2 className="animate-spin" />
                  {progress
                    ? `${progress.done} / ${progress.total}`
                    : "…"}
                </>
              ) : codes.length > 1 ? (
                `兑换 ${codes.length} 条`
              ) : (
                btnText
              )}
            </Button>
            {progress ? (
              <TaskProgress
                active={progress.done < progress.total}
                percent={(progress.done / progress.total) * 100}
                label="批量兑换中…"
                detail={`${progress.done} / ${progress.total}`}
              />
            ) : null}
          </form>

          {/* 单条结果 */}
          {singleResult ? (
            <div className="result-reveal mx-auto mt-7 max-w-md space-y-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="success-pop size-5 text-emerald-600 dark:text-emerald-400" />
                {singleResult.status === "success"
                  ? cfg?.redeemSuccessHint || "兑换成功"
                  : "已兑换"}
              </div>
              <CardContentView
                compact
                type={singleResult.type}
                content={singleResult.content}
                contentEncoding={singleResult.contentEncoding}
                filename={singleResult.filename}
                mime={singleResult.mime}
                size={singleResult.size}
              />
              <button
                type="button"
                className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  setSingleResult(null);
                  setRaw("");
                }}
              >
                继续兑换
              </button>
            </div>
          ) : null}

          {/* 多条结果 + ZIP */}
          {batchItems ? (
            <div className="result-reveal mx-auto mt-7 max-w-md space-y-3 rounded-2xl border border-border/70 bg-secondary/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="success" className="success-pop">
                    成功 {batchOk}
                  </Badge>
                  {batchFail > 0 ? (
                    <Badge variant="destructive">失败 {batchFail}</Badge>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    共 {batchItems.length} 条
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={exporting}
                  onClick={() => void exportZip()}
                >
                  {exporting ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                  导出 ZIP
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                ZIP 内每个卡密一个结果文件，并含 _summary.txt 汇总
              </p>
              <ul className="max-h-80 space-y-2 overflow-y-auto rounded-xl border border-border/60 p-2">
                {batchItems.map((item, idx) => (
                  <li
                    key={item.code}
                    className="stagger-in space-y-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-secondary/40"
                    style={{ "--stagger": Math.min(idx, 10) } as CSSProperties}
                  >
                    <div className="flex items-start gap-2">
                      {item.ok ? (
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono">{item.code}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {item.ok
                            ? item.result?.status === "already_redeemed"
                              ? `已兑换 · ${cardTypeLabel(item.result?.type)}`
                              : `兑换成功 · ${cardTypeLabel(item.result?.type)}`
                            : item.error}
                        </p>
                      </div>
                      {item.ok && item.result ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 shrink-0 px-2"
                          onClick={() => downloadRedeemContent(item.result!)}
                        >
                          <Download className="size-3.5" />
                          下载
                        </Button>
                      ) : null}
                    </div>
                    {item.ok && item.result ? (
                      <CardContentView
                        compact
                        type={item.result.type}
                        content={item.result.content}
                        contentEncoding={item.result.contentEncoding}
                        filename={item.result.filename}
                        mime={item.result.mime}
                        size={item.result.size}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  setBatchItems(null);
                  setRaw("");
                }}
              >
                清空结果，继续兑换
              </button>
            </div>
          ) : null}
        </section>

        {selected && !isEmptyHtml(selected.description) ? (
          <section
            key={selected.slug}
            aria-label={`${selected.name} 说明`}
            className="fade-in fade-in-delay-2 redeem-card w-full rounded-2xl p-6 sm:p-8"
          >
            <div className="mb-3 flex items-center gap-2.5 border-b border-border/50 pb-3">
              <CategoryIconView icon={selected.icon} size={24} />
              <h2 className="min-w-0 truncate text-sm font-medium">
                {selected.name}
                <span className="ml-1.5 font-normal text-muted-foreground">
                  说明
                </span>
              </h2>
            </div>
            <RichTextView
              html={selected.description}
              className="w-full rounded-none border-0 bg-transparent p-0"
            />
          </section>
        ) : null}
      </main>

      {cfg?.footerText ? (
        <footer className="fade-in fade-in-delay-3 py-5 text-center text-[11px] text-muted-foreground">
          {cfg.footerText}
        </footer>
      ) : null}
    </div>
  );
}

function RedeemHeader({
  siteName,
  logo,
  showDocs,
}: {
  siteName: string;
  logo?: string | null;
  showDocs: boolean;
}) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "header-elevated sticky top-0 z-20 border-b border-border/50 bg-background/90 backdrop-blur",
        scrolled && "is-scrolled",
      )}
    >
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-5">
        <SiteBrand name={siteName} logo={logo} />
        <div className="flex items-center gap-0.5">
          {showDocs ? (
            <Button variant="ghost" size="sm" asChild className="text-xs">
              <Link to="/docs">
                <BookOpen className="size-3.5" />
                API
              </Link>
            </Button>
          ) : null}
          <ThemeToggleButton />
        </div>
      </div>
    </header>
  );
}

function StockCount({ value, empty }: { value: number; empty?: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick((t) => t + 1);
  }, [value]);
  return (
    <span
      key={tick}
      className={cn(
        "num-tick font-medium tabular-nums",
        empty ? "text-destructive" : "text-foreground",
      )}
    >
      {value}
    </span>
  );
}

function StockBadge({
  count,
  active,
  compact,
}: {
  count: number;
  active?: boolean;
  compact?: boolean;
}) {
  const empty = count <= 0;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick((t) => t + 1);
  }, [count]);
  return (
    <span
      key={tick}
      className={cn(
        "num-tick tabular-nums",
        compact
          ? "text-[11px] font-semibold"
          : "rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none",
        compact
          ? empty
            ? "text-destructive"
            : "text-muted-foreground"
          : active
            ? empty
              ? "bg-primary-foreground/15 text-primary-foreground"
              : "bg-primary-foreground/20 text-primary-foreground"
            : empty
              ? "bg-destructive/10 text-destructive"
              : "bg-background/85 text-foreground shadow-sm",
      )}
      title={empty ? "暂无库存" : `剩余 ${count} 张`}
    >
      {empty ? "售罄" : compact ? count : `剩 ${count}`}
    </span>
  );
}

function CategoryTab({
  cat,
  stock,
  active,
  onClick,
  stagger = 0,
}: {
  cat: PublicCategory;
  stock: number;
  active: boolean;
  onClick: () => void;
  stagger?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ "--stagger": stagger } as CSSProperties}
      className={cn(
        // 高度/内边距与原先接近，只把图标从 16 提到 20，避免整颗 Tab 被撑宽
        "stagger-in tab-pill interactive-press inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm sm:px-3.5",
        active
          ? "is-active bg-primary text-primary-foreground shadow-sm"
          : "bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      <CategoryIconView
        icon={cat.icon}
        size={20}
        className="shrink-0"
      />
      <span className="max-w-[5.5rem] truncate sm:max-w-[6.5rem]">{cat.name}</span>
      <StockBadge count={stock} active={active} />
    </button>
  );
}
