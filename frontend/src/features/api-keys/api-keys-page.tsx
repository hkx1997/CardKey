import { Eye, EyeOff, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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
import { Input } from "@/components/ui/input";
import type { ApiKeyMeta, ApiScope } from "@/entities/types";
import {
  useApiKeysQuery,
  useCreateApiKey,
  useDeleteApiKey,
  useRevokeApiKey,
  useRotateApiKey,
} from "@/shared/hooks/use-api-keys";
import { useSetPublicRedeemKey, useSettingsQuery } from "@/shared/hooks/use-settings";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { EmptyState } from "@/shared/components/empty-state";
import { FormActions } from "@/shared/components/form-actions";
import { FormField } from "@/shared/components/form-field";
import { IconButton } from "@/shared/components/icon-button";
import { PageContainer } from "@/shared/components/page-container";
import { PageHeader } from "@/shared/components/page-header";
import { PaginationBar } from "@/shared/components/pagination-bar";
import { SecretField } from "@/shared/components/secret-field";
import { usePageSize } from "@/shared/hooks/use-page-size";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/format";
import {
  apiKeyCreateSchema,
  customApiKeySchema,
  fieldErrors,
} from "@/shared/lib/schemas";

const SCOPE_OPTS: { id: ApiScope; label: string; desc: string }[] = [
  {
    id: "redeem:api",
    label: "兑换端",
    desc: "仅可调用 /public/redeem 等兑换相关接口，无法访问管理后台",
  },
  {
    id: "admin:api",
    label: "管理端",
    desc: "可调用全部管理接口（类别/卡密/批次/设置等），亦覆盖兑换与更新权限",
  },
  {
    id: "system:update",
    label: "系统更新",
    desc: "仅一键更新/回滚；不含卡密与设置写操作（也可被 admin:api 覆盖）",
  },
];

export function ApiKeysPage() {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["redeem:api"]);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [customFixed, setCustomFixed] = useState("");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const { pageSize, setPageSize, options: pageSizeOptions } = usePageSize();

  const listQ = useApiKeysQuery();
  const settingsQ = useSettingsQuery();
  const createM = useCreateApiKey();
  const revokeM = useRevokeApiKey();
  const deleteM = useDeleteApiKey();
  const rotateCustomM = useRotateApiKey();
  const rotateFixedM = useSetPublicRedeemKey();

  const systemKey = useMemo(() => {
    const fromList = listQ.data?.find((k) => k.isSystemRedeemKey);
    const secret =
      fromList?.secret || settingsQ.data?.publicRedeemApiKey || "";
    return { meta: fromList, secret };
  }, [listQ.data, settingsQ.data]);

  const customKeys = useMemo(
    () => (listQ.data ?? []).filter((k) => !k.isSystemRedeemKey),
    [listQ.data],
  );

  const pageKeys = useMemo(() => {
    const start = (page - 1) * pageSize;
    return customKeys.slice(start, start + pageSize);
  }, [customKeys, page, pageSize]);

  function toggleScope(s: ApiScope) {
    setScopes((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  function secretOf(k: ApiKeyMeta) {
    if (k.isSystemRedeemKey) return systemKey.secret;
    return k.secret || "";
  }

  function submitCreate() {
    const parsed = fieldErrors(apiKeyCreateSchema, { name, scopes });
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    createM.mutate(
      {
        name: parsed.data.name,
        scopes: parsed.data.scopes,
        rateLimitRpm: 120,
      },
      {
        onSuccess: (res) => {
          setPlaintext(res.plaintext);
          setName("");
          setScopes(["redeem:api"]);
        },
      },
    );
  }

  return (
    <PageContainer className="fade-in">
      <PageHeader
        title="API 密钥"
        description="密钥框内可复制；支持轮换、吊销、永久删除"
        actions={
          <Button
            className="interactive-press"
            onClick={() => {
              setPlaintext(null);
              setErrors({});
              setOpen(true);
            }}
          >
            <Plus />
            创建密钥
          </Button>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">兑换端固定密钥</CardTitle>
          <CardDescription className="text-xs">
            仅 redeem:api · 框内复制 / 轮换 · 或设为自定义值（不可删除）
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <SecretField
            value={systemKey.secret}
            actions={
              <IconButton
                label="轮换密钥"
                disabled={rotateFixedM.isPending || !systemKey.secret}
                onClick={async () => {
                  const ok = await confirm({
                    title: "轮换固定兑换密钥",
                    description: "旧密钥将立即失效，确认继续？",
                    confirmLabel: "轮换",
                    destructive: true,
                  });
                  if (!ok) return;
                  rotateFixedM.mutate(
                    { mode: "rotate" },
                    {
                      onSuccess: (res) => {
                        void navigator.clipboard.writeText(res.plaintext).then(
                          () => toast.message("新密钥已复制"),
                          () => undefined,
                        );
                      },
                    },
                  );
                }}
              >
                <RefreshCw className="size-3.5" />
              </IconButton>
            }
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              className="font-mono text-xs sm:flex-1"
              placeholder="自定义密钥（≥16 位）"
              value={customFixed}
              onChange={(e) => setCustomFixed(e.target.value)}
            />
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0 sm:ml-auto"
              disabled={rotateFixedM.isPending}
              onClick={async () => {
                const parsed = customApiKeySchema.safeParse(customFixed);
                if (!parsed.success) {
                  toast.error(parsed.error.issues[0]?.message ?? "密钥无效");
                  return;
                }
                const ok = await confirm({
                  title: "设为固定密钥",
                  description: "旧密钥立即失效，确认继续？",
                  confirmLabel: "确认",
                  destructive: true,
                });
                if (!ok) return;
                rotateFixedM.mutate(
                  { mode: "custom", customKey: parsed.data },
                  { onSuccess: () => setCustomFixed("") },
                );
              }}
            >
              设为固定密钥
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">自定义密钥</CardTitle>
          <CardDescription className="text-xs">
            吊销后立即失效但仍可清理删除；永久删除从列表移除
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {customKeys.length === 0 && !listQ.isLoading ? (
            <EmptyState>暂无自定义密钥</EmptyState>
          ) : (
            <div className="space-y-3">
              {pageKeys.map((k) => {
                const secret = secretOf(k);
                const show = !!revealed[k.id];
                return (
                  <div
                    key={k.id}
                    className="space-y-2.5 rounded-xl border border-border/70 p-3 sm:p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{k.name}</span>
                          {k.revokedAt ? (
                            <Badge variant="destructive">已吊销</Badge>
                          ) : (
                            <Badge variant="success">有效</Badge>
                          )}
                          {k.scopes.map((s) => (
                            <Badge
                              key={s}
                              variant="outline"
                              className="font-mono text-[10px]"
                            >
                              {s}
                            </Badge>
                          ))}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          RPM {k.rateLimitRpm ?? "—"} · 创建{" "}
                          {formatDateTime(k.createdAt)}
                          {k.lastUsedAt
                            ? ` · 最近 ${formatDateTime(k.lastUsedAt)}`
                            : ""}
                          {k.revokedAt
                            ? ` · 吊销 ${formatDateTime(k.revokedAt)}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-0.5">
                        {!k.revokedAt ? (
                          <>
                            <IconButton
                              label="轮换"
                              disabled={rotateCustomM.isPending}
                              onClick={async () => {
                                const ok = await confirm({
                                  title: `轮换「${k.name}」`,
                                  description: "旧密钥立即失效，确认继续？",
                                  confirmLabel: "轮换",
                                  destructive: true,
                                });
                                if (!ok) return;
                                rotateCustomM.mutate(k.id, {
                                  onSuccess: (res) => {
                                    setPlaintext(res.plaintext);
                                    setOpen(true);
                                  },
                                });
                              }}
                            >
                              <RefreshCw className="size-3.5" />
                            </IconButton>
                            <IconButton
                              label="吊销"
                              disabled={revokeM.isPending}
                              className="hover:text-destructive"
                              onClick={async () => {
                                const ok = await confirm({
                                  title: `吊销「${k.name}」`,
                                  description:
                                    "吊销后密钥立即失效；如需清理可再点删除。",
                                  confirmLabel: "吊销",
                                  destructive: true,
                                });
                                if (!ok) return;
                                revokeM.mutate(k.id);
                              }}
                            >
                              <XCircle className="size-3.5" />
                            </IconButton>
                          </>
                        ) : null}
                        <IconButton
                          label="永久删除"
                          disabled={deleteM.isPending}
                          className="hover:text-destructive"
                          onClick={async () => {
                            const ok = await confirm({
                              title: `删除「${k.name}」`,
                              description: k.revokedAt
                                ? "将从列表永久移除该密钥记录。"
                                : "将立即失效并永久删除，不可恢复。",
                              confirmLabel: "删除",
                              destructive: true,
                            });
                            if (!ok) return;
                            deleteM.mutate(k.id);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      </div>
                    </div>
                    <SecretField
                      value={secret}
                      display={
                        show
                          ? secret || "（无完整密钥）"
                          : `${k.keyPrefix}${"•".repeat(18)}`
                      }
                      monoClassName={cn(
                        k.revokedAt && "opacity-50 line-through",
                      )}
                      actions={
                        !k.revokedAt ? (
                          <IconButton
                            label={show ? "隐藏" : "显示"}
                            onClick={() =>
                              setRevealed((r) => ({
                                ...r,
                                [k.id]: !r[k.id],
                              }))
                            }
                          >
                            {show ? (
                              <EyeOff className="size-3.5" />
                            ) : (
                              <Eye className="size-3.5" />
                            )}
                          </IconButton>
                        ) : null
                      }
                    />
                  </div>
                );
              })}
              {customKeys.length > 0 ? (
                <PaginationBar
                  page={page}
                  pageSize={pageSize}
                  total={customKeys.length}
                  onPageChange={setPage}
                  onPageSizeChange={(n) => {
                    setPageSize(n);
                    setPage(1);
                  }}
                  pageSizeOptions={pageSizeOptions}
                />
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            setPlaintext(null);
            setName("");
            setScopes(["redeem:api"]);
            setErrors({});
          }
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>
              {plaintext ? "新密钥（请复制）" : "创建 API 密钥"}
            </DialogTitle>
            <DialogDescription>
              {plaintext
                ? "密钥已生成，点击框内图标复制"
                : "勾选兑换或管理权限"}
            </DialogDescription>
          </DialogHeader>
          {plaintext ? (
            <div className="space-y-3">
              <SecretField value={plaintext} />
              <FormActions>
                <Button onClick={() => setOpen(false)}>完成</Button>
              </FormActions>
            </div>
          ) : (
            <div className="space-y-4">
              <FormField label="名称" required error={errors.name}>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：渠道 A"
                />
              </FormField>
              <FormField label="权限" required error={errors.scopes}>
                <div className="grid gap-2">
                  {SCOPE_OPTS.map((opt) => {
                    const on = scopes.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => toggleScope(opt.id)}
                        className={cn(
                          "interactive-press rounded-lg border px-3 py-2.5 text-left transition-colors",
                          on
                            ? "border-foreground/30 bg-secondary/60"
                            : "border-border/70 hover:bg-secondary/40",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium">
                            {opt.label}
                          </span>
                          <code className="font-mono text-[10px] text-muted-foreground">
                            {opt.id}
                          </code>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {opt.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </FormField>
              <FormActions>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button
                  className="interactive-press"
                  disabled={createM.isPending}
                  onClick={submitCreate}
                >
                  创建
                </Button>
              </FormActions>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
