import { ArrowUpCircle, History, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { MarkdownBody } from "@/shared/components/markdown-body";
import { ReloadCountdown } from "@/shared/components/reload-countdown";
import { TaskProgress } from "@/shared/components/task-progress";
import { api } from "@/shared/api/client";
import {
  useApplyUpdate,
  useCheckUpdates,
  useRollbackUpdate,
  useSystemInfoQuery,
  useUpdateHistory,
} from "@/shared/hooks/use-system";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/format";
import { getErrorMessage } from "@/shared/lib/api-toast";
import {
  isLikelyRestartDisconnect,
  RELOAD_COUNTDOWN_SEC,
  waitForRestartAndReload,
  type RestartWaitState,
} from "@/shared/lib/wait-for-restart";

/** 侧栏底部版本号 + 更新面板 */
export function SystemVersion({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const infoQ = useSystemInfoQuery();
  const version = infoQ.data?.version ?? "…";
  const checkM = useCheckUpdates();
  const historyQ = useUpdateHistory(open);
  const applyM = useApplyUpdate();
  const rollbackM = useRollbackUpdate();
  const confirm = useConfirm();
  const [restartWait, setRestartWait] = useState<RestartWaitState | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [applyProgress, setApplyProgress] = useState<number | undefined>();

  // 进入管理端后软检测更新（服务端有缓存），用于「新」角标
  useEffect(() => {
    if (checkM.data || checkM.isPending) return;
    const t = window.setTimeout(() => {
      checkM.mutate();
    }, 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载软检测一次
  }, []);

  const check = checkM.data;
  const hasUpdate = !!check?.hasUpdate;
  const waitingRestart =
    busy ||
    (!!restartWait &&
      restartWait.phase !== "timeout" &&
      restartWait.phase !== "ready");

  const runApplyOrRollback = useCallback(
    async (opts: {
      action: () => Promise<unknown>;
      targetVersion?: string;
      label: string;
      failLabel: string;
    }) => {
      setBusy(true);
      setApplyProgress(5);
      setRestartWait({
        phase: "applying",
        attempt: 0,
        message: `${opts.label}中，请勿关闭页面…`,
      });

      const poll = window.setInterval(() => {
        void api
          .updateStatus()
          .then((st: {
            state?: string;
            message?: string;
            progress?: number;
            error?: string;
          }) => {
            if (typeof st.progress === "number") setApplyProgress(st.progress);
            if (st.message) {
              const msg = st.message;
              setRestartWait((prev) =>
                prev ? { ...prev, message: msg } : prev,
              );
            }
          })
          .catch(() => {
            /* 进程退出时忽略 */
          });
      }, 900);

      let submitted = false;
      try {
        await opts.action();
        submitted = true;
      } catch (err) {
        if (isLikelyRestartDisconnect(err)) {
          submitted = true;
          toast.message("连接已中断，即将开始倒计时刷新…");
        } else {
          window.clearInterval(poll);
          setBusy(false);
          setApplyProgress(undefined);
          setRestartWait(null);
          toast.error(getErrorMessage(err, opts.failLabel));
          return;
        }
      } finally {
        window.clearInterval(poll);
      }

      if (!submitted) {
        setBusy(false);
        return;
      }

      toast.message(
        `${opts.label}已提交，${RELOAD_COUNTDOWN_SEC} 秒后自动刷新页面`,
      );
      await waitForRestartAndReload({
        targetVersion: opts.targetVersion,
        previousVersion: infoQ.data?.version,
        countdownSec: RELOAD_COUNTDOWN_SEC,
        onStatus: setRestartWait,
      });
      // hardReload 后不会执行到这里
    },
    [infoQ.data?.version],
  );

  const countdownActive =
    restartWait?.phase === "countdown" || restartWait?.phase === "ready";
  const remaining = restartWait?.remainingSec ?? RELOAD_COUNTDOWN_SEC;
  const total = restartWait?.totalSec ?? RELOAD_COUNTDOWN_SEC;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[11px] text-muted-foreground",
          "transition-colors hover:bg-secondary/60 hover:text-foreground",
          className,
        )}
        title="系统版本与更新"
      >
        <span className="font-mono tabular-nums">v{version}</span>
        {hasUpdate ? (
          <Badge variant="destructive" className="h-4 px-1 text-[9px]">
            新
          </Badge>
        ) : null}
        <RefreshCw className="ml-auto size-3 opacity-50 group-hover:opacity-100" />
      </button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v && waitingRestart) return;
          setOpen(v);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex min-w-0 flex-wrap items-center gap-2">
              系统更新
              <span className="font-mono text-xs font-normal text-muted-foreground">
                v{version}
              </span>
            </DialogTitle>
            <DialogDescription className="break-all text-xs">
              模式 {infoQ.data?.updateMode ?? "—"} · commit{" "}
              <span className="font-mono">{infoQ.data?.commit ?? "—"}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="dialog-body space-y-4 text-sm">
            {/* 无「数据库迁移 / SQL 列表」等运维说明 */}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                loading={checkM.isPending}
                disabled={waitingRestart}
                onClick={() => checkM.mutate()}
              >
                {checkM.isPending ? (
                  "检测中…"
                ) : (
                  <>
                    <RefreshCw className="size-3.5" />
                    检测更新
                  </>
                )}
              </Button>
            </div>

            {restartWait?.phase === "applying" ? (
              <TaskProgress
                active
                percent={applyProgress}
                label={restartWait.message}
                detail="请勿关闭页面"
              />
            ) : null}

            {countdownActive ? (
              <ReloadCountdown
                remaining={remaining}
                total={total}
                label={restartWait?.message}
              />
            ) : null}

            {check ? (
              <div className="rounded-lg border border-border/70 bg-secondary/30 p-3 text-xs space-y-2">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">当前</span>
                  <span className="font-mono">v{check.current}</span>
                </div>
                {check.latest ? (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">最新</span>
                    <span className="font-mono">v{check.latest}</span>
                  </div>
                ) : null}
                {check.hasUpdate ? (
                  <p className="text-amber-600 dark:text-amber-400">
                    发现新版本 v{check.latest}
                    {check.releaseUrl ? (
                      <>
                        {" · "}
                        <a
                          href={check.releaseUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="underline underline-offset-2"
                        >
                          Release
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    {check.message || "已是最新版本"}
                  </p>
                )}
                {check.body ? (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-medium text-foreground">
                      更新内容
                    </p>
                    <MarkdownBody source={check.body} />
                  </div>
                ) : check.hasUpdate ? (
                  <p className="text-[11px] text-muted-foreground">
                    暂无 Release 说明
                  </p>
                ) : null}
                {check.hasUpdate &&
                (check.mode === "binary" || check.mode === "docker") ? (
                  <Button
                    size="sm"
                    className="w-full"
                    loading={busy || applyM.isPending}
                    disabled={busy || applyM.isPending || rollbackM.isPending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `更新到 v${check.latest}`,
                        description: `下载并替换后重启，约 ${RELOAD_COUNTDOWN_SEC} 秒后自动刷新页面。`,
                        confirmLabel: "一键更新并重启",
                        destructive: true,
                      });
                      if (!ok) return;
                      await runApplyOrRollback({
                        action: () => applyM.mutateAsync(check.latest),
                        targetVersion: check.latest,
                        label: "更新",
                        failLabel: "更新失败",
                      });
                    }}
                  >
                    <ArrowUpCircle className="size-3.5" />
                    一键更新并重启
                  </Button>
                ) : null}
              </div>
            ) : null}

            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
                <History className="size-3.5" />
                版本历史 / 回滚
              </div>
              <p className="mb-2 text-[10px] text-muted-foreground leading-relaxed">
                仅列出本机归档与更旧的 GitHub 版本；更新版本请用上方「检测更新」。
              </p>
              {historyQ.isLoading ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (historyQ.data ?? []).length === 0 ? (
                <p className="text-[11px] text-muted-foreground">暂无版本记录</p>
              ) : (
                <ul className="max-h-52 space-y-1 overflow-auto text-xs">
                  {(historyQ.data ?? []).map((h) => {
                    const sourceLabel =
                      h.source === "remote"
                        ? "GitHub"
                        : h.source === "both"
                          ? "本机+远程"
                          : h.source === "local"
                            ? "本机"
                            : "";
                    // 回滚：非当前；远程项应为更旧版本（后端已过滤更高版本）
                    const canSwitch =
                      !h.isCurrent &&
                      h.canInstall !== false &&
                      h.source !== "remote-newer" &&
                      (infoQ.data?.updateMode === "binary" ||
                        infoQ.data?.updateMode === "docker");
                    const switchLabel =
                      h.source === "local" &&
                      version &&
                      version !== "…" &&
                      h.version.localeCompare(String(version).replace(/^v/i, ""), undefined, {
                        numeric: true,
                      }) > 0
                        ? "切换"
                        : "回滚";
                    return (
                      <li
                        key={h.version + (h.path ?? "") + (h.source ?? "")}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-2 py-1.5"
                      >
                        <div className="min-w-0 flex flex-wrap items-center gap-1.5">
                          <span className="font-mono">v{h.version}</span>
                          {h.isCurrent ? (
                            <Badge
                              variant="secondary"
                              className="h-4 px-1 text-[9px]"
                            >
                              当前
                            </Badge>
                          ) : null}
                          {sourceLabel ? (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 text-[9px] font-normal"
                            >
                              {sourceLabel}
                            </Badge>
                          ) : null}
                          {h.modTime ? (
                            <span className="text-[10px] text-muted-foreground">
                              {formatDateTime(h.modTime)}
                            </span>
                          ) : null}
                        </div>
                        {canSwitch ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 shrink-0 text-[11px]"
                            disabled={busy || rollbackM.isPending}
                            onClick={async () => {
                              const fromRemote =
                                h.source === "remote" || h.source === "both";
                              const ok = await confirm({
                                title: `${switchLabel}到 v${h.version}`,
                                description: fromRemote
                                  ? "将切换到该旧版本（本机无包则从 GitHub 下载）并重启。"
                                  : "将切换到该版本并重启。",
                                confirmLabel: fromRemote
                                  ? "下载并回滚"
                                  : switchLabel,
                                destructive: true,
                              });
                              if (!ok) return;
                              await runApplyOrRollback({
                                action: () => rollbackM.mutateAsync(h.version),
                                targetVersion: h.version,
                                label: switchLabel,
                                failLabel: `${switchLabel}失败`,
                              });
                            }}
                          >
                            {switchLabel}
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              {infoQ.data?.updateMode === "binary" ||
              infoQ.data?.updateMode === "docker" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 w-full"
                  disabled={busy || rollbackM.isPending}
                  onClick={async () => {
                    const ok = await confirm({
                      title: "回滚到上一备份 (.bak)",
                      description: "使用本机 .bak 替换当前版本并重启。",
                      confirmLabel: "回滚 .bak",
                      destructive: true,
                    });
                    if (!ok) return;
                    await runApplyOrRollback({
                      action: () => rollbackM.mutateAsync("previous"),
                      label: "回滚",
                      failLabel: "回滚失败",
                    });
                  }}
                >
                  回滚到 .bak
                </Button>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
