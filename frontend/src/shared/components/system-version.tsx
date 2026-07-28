import { ArrowUpCircle, History, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
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
import { TaskProgress } from "@/shared/components/task-progress";
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
  /** 应用/回滚进行中（含等待重启），禁用重复点击 */
  const [busy, setBusy] = useState(false);

  const check = checkM.data;
  const hasUpdate = !!check?.hasUpdate;
  const waitingRestart =
    busy || (!!restartWait && restartWait.phase !== "timeout");

  /**
   * 提交更新/回滚后始终进入「等重启 → 硬刷新」。
   * 下载完成后进程会退出，客户端常见 Failed to fetch / 502，不能只依赖 onSuccess。
   */
  const runApplyOrRollback = useCallback(
    async (opts: {
      action: () => Promise<unknown>;
      targetVersion?: string;
      label: string;
      failLabel: string;
    }) => {
      const previousVersion = infoQ.data?.version;
      setBusy(true);
      setRestartWait({
        phase: "waiting_down",
        attempt: 0,
        message: `${opts.label}中，请勿关闭页面…`,
      });

      let submitted = false;
      try {
        await opts.action();
        submitted = true;
      } catch (err) {
        if (isLikelyRestartDisconnect(err)) {
          // 进程可能已退出并替换成功
          submitted = true;
          toast.message("连接已中断，正在检测服务是否完成重启…");
        } else {
          setBusy(false);
          setRestartWait(null);
          toast.error(getErrorMessage(err, opts.failLabel));
          return;
        }
      }

      if (!submitted) {
        setBusy(false);
        return;
      }

      toast.message(`${opts.label}已提交，将自动检测恢复并刷新…`);
      const ok = await waitForRestartAndReload({
        targetVersion: opts.targetVersion,
        previousVersion,
        onStatus: setRestartWait,
      });
      if (!ok) {
        setBusy(false);
        setRestartWait({
          phase: "timeout",
          attempt: 0,
          message: "等待超时，请手动刷新页面（Ctrl+Shift+R）",
        });
        toast.error("自动刷新超时，请手动强制刷新（Ctrl+Shift+R）");
      }
      // ok 时页面会 hardReload，不必 setBusy(false)
    },
    [infoQ.data?.version],
  );

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
          // 等待重启时禁止误关
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
            {infoQ.data?.migrationsEmbedded ? (
              <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
                <p className="font-medium text-foreground">数据库迁移随版本包</p>
                <p className="mt-0.5">
                  SQL 嵌入二进制；一键更新替换进程并重启后，会自动执行尚未应用的迁移（不删库、不
                  down -v）。
                </p>
                {infoQ.data.migrationsApplied &&
                infoQ.data.migrationsApplied.length > 0 ? (
                  <p className="mt-1 font-mono text-[10px] break-all">
                    已应用：{infoQ.data.migrationsApplied.join(", ")}
                  </p>
                ) : null}
              </div>
            ) : null}

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

            {restartWait ? (
              <TaskProgress
                active={restartWait.phase !== "timeout" && restartWait.phase !== "ready"}
                percent={
                  restartWait.phase === "ready"
                    ? 100
                    : restartWait.phase === "timeout"
                      ? undefined
                      : undefined
                }
                label={restartWait.message}
                detail={
                  restartWait.version
                    ? `探测 v${restartWait.version} · 第 ${restartWait.attempt} 次`
                    : `第 ${restartWait.attempt} 次探测`
                }
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
                          查看 Release
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    {check.message || "已是最新版本"}
                  </p>
                )}
                {check.hasUpdate && check.message ? (
                  <p className="text-muted-foreground whitespace-pre-wrap">
                    {check.message}
                  </p>
                ) : null}
                {check.fromCache ? (
                  <p className="text-[10px] text-muted-foreground/80">
                    含缓存数据；点击「检测更新」会强制刷新
                  </p>
                ) : null}
                {check.tokenRecommended && !check.latest ? (
                  <p className="text-[10px] text-muted-foreground">
                    可选配置{" "}
                    <code className="font-mono">UPDATE_GITHUB_TOKEN</code>{" "}
                    提高检测成功率（默认已走非 API 通道，无需 Token）。
                  </p>
                ) : null}
                {check.body ? (
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded border bg-background/60 p-2 font-sans text-[11px] text-muted-foreground">
                    {check.body.slice(0, 2000)}
                  </pre>
                ) : null}
                {applyM.isPending || rollbackM.isPending ? (
                  <TaskProgress
                    active
                    label={
                      applyM.isPending
                        ? "正在下载并应用更新…"
                        : "正在回滚版本…"
                    }
                    detail="请勿关闭页面"
                  />
                ) : null}
                {check.hasUpdate ? (
                  <div className="space-y-2">
                    {(check.mode === "binary" || check.mode === "docker") && (
                      <Button
                        size="sm"
                        className="w-full"
                        loading={busy || applyM.isPending}
                        disabled={busy || applyM.isPending || rollbackM.isPending}
                        onClick={async () => {
                          const ok = await confirm({
                            title: `更新到 v${check.latest}`,
                            description:
                              "将下载 Linux 二进制（含内嵌数据库迁移），替换当前进程并自动重启；启动时执行未应用的 SQL。恢复后页面会自动强制刷新。",
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
                    )}
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      也可在服务器执行{" "}
                      <code className="font-mono">
                        bash scripts/upgrade.sh v{check.latest}
                      </code>
                      （只重建应用，不删库）。勿使用{" "}
                      <code className="font-mono">down -v</code>。
                    </p>
                  </div>
                ) : null}
                {check.mode === "docker" ? (
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Release 附带{" "}
                    <code className="font-mono">cardkey-linux-amd64/arm64</code>
                    ，一键更新会替换容器内二进制并由 restart 拉起。
                  </p>
                ) : null}
              </div>
            ) : null}

            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
                <History className="size-3.5" />
                本地历史 / 回滚
              </div>
              {historyQ.isLoading ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <ul className="max-h-40 space-y-1 overflow-auto text-xs">
                  {(historyQ.data ?? []).map((h) => (
                    <li
                      key={h.version + (h.path ?? "")}
                      className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-2 py-1.5"
                    >
                      <span className="font-mono">
                        v{h.version}
                        {h.isCurrent ? (
                          <span className="ml-1 text-muted-foreground">
                            (当前)
                          </span>
                        ) : null}
                      </span>
                      {!h.isCurrent &&
                      (infoQ.data?.updateMode === "binary" ||
                        infoQ.data?.updateMode === "docker") ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[11px]"
                          disabled={busy || rollbackM.isPending}
                          onClick={async () => {
                            const ok = await confirm({
                              title: `回滚到 v${h.version}`,
                              description:
                                "将切换到该版本并重启。恢复后页面会自动强制刷新。若数据库迁移不可逆，请谨慎操作。",
                              confirmLabel: "回滚",
                              destructive: true,
                            });
                            if (!ok) return;
                            await runApplyOrRollback({
                              action: () => rollbackM.mutateAsync(h.version),
                              targetVersion: h.version,
                              label: "回滚",
                              failLabel: "回滚失败",
                            });
                          }}
                        >
                          回滚
                        </Button>
                      ) : null}
                      {h.modTime ? (
                        <span className="hidden text-[10px] text-muted-foreground sm:inline">
                          {formatDateTime(h.modTime)}
                        </span>
                      ) : null}
                    </li>
                  ))}
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
                      title: "回滚到上一备份",
                      description:
                        "使用 .bak 替换当前二进制并重启；恢复后页面会自动强制刷新。",
                      confirmLabel: "回滚",
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
