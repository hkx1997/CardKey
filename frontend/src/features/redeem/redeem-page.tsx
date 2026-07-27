import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Download,
  Loader2,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { ThemeToggleButton } from "@/shared/components/theme-toggle-button";
import {
  useBatchRedeemMutation,
  usePublicConfigQuery,
  useRedeemMutation,
} from "@/shared/hooks/use-public-config";
import {
  cardTypeLabel,
  downloadRedeemContent,
} from "@/shared/lib/card-content";
import { CategoryIconView } from "@/shared/lib/category-icons";
import { cn } from "@/shared/lib/cn";
import {
  buildRedeemZip,
  downloadBlob,
  parseRedeemCodes,
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

  const configQ = usePublicConfigQuery();
  const redeemM = useRedeemMutation();
  const batchM = useBatchRedeemMutation();

  const cfg = configQ.data;
  const categories = cfg?.categories ?? [];
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

    clearResults();

    // 单条：走原有单次兑换体验
    if (codes.length === 1) {
      const code = codes[0]!;
      redeemM.mutate(
        { category, code },
        {
          onSuccess: (data) => {
            setSingleResult(data);
            toast.success(cfg?.redeemSuccessHint || "兑换成功");
          },
          onError: () => setSingleResult(null),
        },
      );
      return;
    }

    // 多条：批量
    setProgress({ done: 0, total: codes.length });
    batchM.mutate(
      {
        category,
        codes,
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
        },
        onError: () => {
          setProgress(null);
          toast.error("批量兑换中断");
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

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border/50 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-5">
          <SiteBrand name={siteName} logo={cfg?.siteLogo} />
          <div className="flex items-center gap-1">
            {cfg?.showApiDocsEntry ? (
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

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-5 py-10 sm:gap-6 sm:py-14">
        <div className="fade-in text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground sm:text-[15px]">
              {subtitle}
            </p>
          ) : null}
        </div>

        <section
          aria-label="兑换"
          className="fade-in ui-lift w-full rounded-2xl border border-border/70 bg-card p-6 shadow-sm sm:p-8"
        >
          <div className="mb-6">
            {categories.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground">
                暂无可用类别
              </p>
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                {primaryTabs.map((c) => (
                  <CategoryTab
                    key={c.slug}
                    cat={c}
                    active={category === c.slug}
                    onClick={() => selectCategory(c.slug)}
                  />
                ))}
                {moreTabs.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "interactive-press inline-flex h-10 items-center gap-1 rounded-full px-4 text-sm transition-colors",
                          inMore
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground",
                        )}
                      >
                        更多
                        <ChevronDown className="size-3.5 opacity-70" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center" className="w-48">
                      {moreTabs.map((c) => (
                        <DropdownMenuItem
                          key={c.slug}
                          onClick={() => selectCategory(c.slug)}
                          className={cn(category === c.slug && "bg-accent")}
                        >
                          <CategoryIconView icon={c.icon} size={14} />
                          {c.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )}
          </div>

          <form onSubmit={onSubmit} className="mx-auto max-w-md space-y-3">
            <Textarea
              autoComplete="off"
              spellCheck={false}
              placeholder={`一行一个兑换编码，支持单个或多个\n${placeholder}`}
              className="min-h-[120px] font-mono text-sm leading-relaxed sm:min-h-[140px]"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              disabled={busy || !category}
            />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {codes.length <= 1
                  ? codes.length === 1
                    ? "1 条编码"
                    : "请输入编码"
                  : `${codes.length} 条编码（已去重，不限条数）`}
              </span>
            </div>
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
              className="interactive-press h-11 w-full text-sm"
              disabled={busy || !category || codes.length === 0}
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
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{
                    width: `${Math.round((progress.done / progress.total) * 100)}%`,
                  }}
                />
              </div>
            ) : null}
          </form>

          {/* 单条结果 */}
          {singleResult ? (
            <div className="fade-in mx-auto mt-6 max-w-md space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
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
            <div className="fade-in mx-auto mt-6 max-w-md space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="success">成功 {batchOk}</Badge>
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
                {batchItems.map((item) => (
                  <li
                    key={item.code}
                    className="space-y-1.5 rounded-lg px-2 py-1.5 text-xs hover:bg-secondary/40"
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
            aria-label={`${selected.name} 说明`}
            className="fade-in w-full rounded-2xl border border-border/70 bg-card p-6 shadow-sm sm:p-8"
          >
            <div className="mb-3 flex items-center gap-2 border-b border-border/50 pb-3">
              <CategoryIconView icon={selected.icon} size={16} />
              <h2 className="text-sm font-medium">
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
        <footer className="py-4 text-center text-[11px] text-muted-foreground">
          {cfg.footerText}
        </footer>
      ) : null}
    </div>
  );
}

function CategoryTab({
  cat,
  active,
  onClick,
}: {
  cat: PublicCategory;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "interactive-press inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      <CategoryIconView icon={cat.icon} size={16} />
      <span>{cat.name}</span>
    </button>
  );
}
