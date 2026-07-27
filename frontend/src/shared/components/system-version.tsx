import { ArrowUpCircle, History, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
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
import {
  useApplyUpdate,
  useCheckUpdates,
  useRollbackUpdate,
  useSystemInfoQuery,
  useUpdateHistory,
} from "@/shared/hooks/use-system";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/format";

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

  const check = checkM.data;
  const hasUpdate = !!check?.hasUpdate;

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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              系统更新
              <span className="font-mono text-xs font-normal text-muted-foreground">
                v{version}
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              模式 {infoQ.data?.updateMode ?? "—"} · commit{" "}
              <span className="font-mono">{infoQ.data?.commit ?? "—"}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                loading={checkM.isPending}
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
                    发现新版本
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
                {check.message && check.hasUpdate ? (
                  <p className="text-muted-foreground">{check.message}</p>
                ) : null}
                {check.fromCache ? (
                  <p className="text-[10px] text-muted-foreground/80">
                    结果来自缓存（约 15 分钟内有效）
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
                {check.mode === "binary" && check.hasUpdate ? (
                  <Button
                    size="sm"
                    className="w-full"
                    loading={applyM.isPending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `更新到 v${check.latest}`,
                        description:
                          "将下载二进制并重启服务（约数秒中断）。确认继续？",
                        confirmLabel: "立即更新",
                        destructive: true,
                      });
                      if (!ok) return;
                      applyM.mutate(check.latest, {
                        onSuccess: () =>
                          toast.message("更新已提交，服务即将重启…"),
                      });
                    }}
                  >
                    <ArrowUpCircle className="size-3.5" />
                    一键更新
                  </Button>
                ) : null}
                {check.mode === "docker" ? (
                  <code className="block rounded border bg-background p-2 font-mono text-[10px]">
                    docker compose pull && docker compose up -d
                  </code>
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
                      {!h.isCurrent && infoQ.data?.updateMode === "binary" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[11px]"
                          disabled={rollbackM.isPending}
                          onClick={async () => {
                            const ok = await confirm({
                              title: `回滚到 v${h.version}`,
                              description:
                                "将切换到该版本并重启。若数据库迁移不可逆，请谨慎操作。",
                              confirmLabel: "回滚",
                              destructive: true,
                            });
                            if (!ok) return;
                            rollbackM.mutate(h.version, {
                              onSuccess: () =>
                                toast.message("回滚已提交，服务即将重启…"),
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
              {infoQ.data?.updateMode === "binary" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 w-full"
                  disabled={rollbackM.isPending}
                  onClick={async () => {
                    const ok = await confirm({
                      title: "回滚到上一备份",
                      description: "使用 cardkey.bak 替换当前二进制并重启。",
                      confirmLabel: "回滚",
                      destructive: true,
                    });
                    if (!ok) return;
                    rollbackM.mutate("previous");
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
