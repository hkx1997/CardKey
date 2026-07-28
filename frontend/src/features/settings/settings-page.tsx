import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import type { Settings } from "@/entities/types";
import { FormField } from "@/shared/components/form-field";
import { ImageUploadField } from "@/shared/components/image-upload-field";
import { LoadingBlock } from "@/shared/components/loading-block";
import { PageContainer } from "@/shared/components/page-container";
import { PageHeader } from "@/shared/components/page-header";
import { SettingsSection } from "@/shared/components/settings-section";
import { ToggleRow } from "@/shared/components/toggle-row";
import { useCategoriesQuery } from "@/shared/hooks/use-categories";
import {
  useSettingsQuery,
  useTestMail,
  useUpdateSettings,
} from "@/shared/hooks/use-settings";
import { resolveApiBase } from "@/shared/lib/api-base";
import { cn } from "@/shared/lib/cn";

export function SettingsPage() {
  const q = useSettingsQuery();
  const catsQ = useCategoriesQuery();
  const m = useUpdateSettings();
  const testMailM = useTestMail();
  const [form, setForm] = useState<Settings | null>(null);
  const [baseline, setBaseline] = useState<Settings | null>(null);
  const [tab, setTab] = useState("general");
  const [testTo, setTestTo] = useState("");

  useEffect(() => {
    if (!q.data) return;
    const normalized: Settings = {
      ...q.data,
      mailCardAlertCategoryIds: q.data.mailCardAlertCategoryIds ?? [],
    };
    if (!form || !baseline) {
      setForm(normalized);
      setBaseline(normalized);
      return;
    }
    const isDirty = JSON.stringify(form) !== JSON.stringify(baseline);
    if (!isDirty) {
      setForm(normalized);
      setBaseline(normalized);
    }
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!form || !baseline) return;
      if (JSON.stringify(form) !== JSON.stringify(baseline)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [form, baseline]);

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  if (!form) {
    return (
      <PageContainer>
        <PageHeader title="系统设置" />
        <LoadingBlock rows={6} />
      </PageContainer>
    );
  }

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  function save() {
    if (!form) return;
    m.mutate(form, {
      onSuccess: (data) => {
        setForm(data);
        setBaseline(data);
      },
    });
  }

  return (
    <PageContainer>
      <PageHeader
        title="系统设置"
        description={
          dirty
            ? "有未保存的更改 — 切换 Tab 不会丢失，请点右上角保存"
            : "基本配置与邮件预警"
        }
        actions={
          <Button
            className={
              dirty
                ? "interactive-press shadow-md ring-2 ring-primary/30"
                : "interactive-press"
            }
            disabled={m.isPending || !dirty}
            onClick={save}
          >
            {m.isPending ? "保存中…" : dirty ? "保存" : "已保存"}
          </Button>
        }
      />
      {dirty ? (
        <div className="sticky top-0 z-10 mb-3 flex items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          <span>有未保存的更改</span>
          <Button size="sm" className="h-7" disabled={m.isPending} onClick={save}>
            {m.isPending ? "保存中…" : "立即保存"}
          </Button>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-secondary/50 p-1 sm:w-auto">
          <TabsTrigger value="general" className="px-4">
            基本设置
          </TabsTrigger>
          <TabsTrigger value="mail" className="px-4">
            邮件提醒
          </TabsTrigger>
        </TabsList>

        {/* —— 基本设置（原有内容） —— */}
        <TabsContent value="general" className="space-y-4">
          <SettingsSection title="品牌">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="站点名称">
                <Input
                  value={form.siteName}
                  onChange={(e) => set("siteName", e.target.value)}
                />
              </FormField>
              <FormField label="浏览器标题">
                <Input
                  value={form.documentTitle}
                  onChange={(e) => set("documentTitle", e.target.value)}
                />
              </FormField>
              <FormField label="站点 Logo" className="sm:col-span-2">
                <ImageUploadField
                  value={form.siteLogo}
                  onChange={(v) => set("siteLogo", v)}
                  hint="支持 PNG/JPEG/WebP/ICO，最大 2MB；也可填外链 URL（不支持 SVG）"
                />
              </FormField>
              <FormField label="Favicon" className="sm:col-span-2">
                <ImageUploadField
                  value={form.siteFavicon}
                  onChange={(v) => set("siteFavicon", v)}
                  hint="浏览器标签图标，建议正方形 PNG/ICO；上传后点右上角「保存」才会生效"
                />
              </FormField>
              <FormField label="页脚" className="sm:col-span-2">
                <Input
                  value={form.footerText}
                  onChange={(e) => set("footerText", e.target.value)}
                />
              </FormField>
            </div>
          </SettingsSection>

          <SettingsSection title="兑换页">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="标题">
                <Input
                  value={form.redeemTitle}
                  onChange={(e) => set("redeemTitle", e.target.value)}
                />
              </FormField>
              <FormField label="按钮文案">
                <Input
                  value={form.redeemButtonText}
                  onChange={(e) => set("redeemButtonText", e.target.value)}
                />
              </FormField>
              <FormField label="副标题" className="sm:col-span-2">
                <Input
                  value={form.redeemSubtitle}
                  onChange={(e) => set("redeemSubtitle", e.target.value)}
                />
              </FormField>
              <FormField label="输入框占位" hint="空则按类别前缀生成">
                <Input
                  value={form.redeemPlaceholder}
                  onChange={(e) => set("redeemPlaceholder", e.target.value)}
                />
              </FormField>
              <FormField label="成功提示">
                <Input
                  value={form.redeemSuccessHint}
                  onChange={(e) => set("redeemSuccessHint", e.target.value)}
                />
              </FormField>
              <FormField label="主 Tab 数量">
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={form.redeemTabVisibleCount}
                  onChange={(e) =>
                    set(
                      "redeemTabVisibleCount",
                      Math.max(1, Math.min(20, Number(e.target.value) || 1)),
                    )
                  }
                />
              </FormField>
            </div>
          </SettingsSection>

          <SettingsSection title="安全">
            <div className="space-y-3">
              <ToggleRow
                label="允许已兑再查"
                checked={form.allowRequery}
                onChange={(v) => set("allowRequery", v)}
              />
              <ToggleRow
                label="错误掩码"
                checked={form.maskCardErrors}
                onChange={(v) => set("maskCardErrors", v)}
              />
              <ToggleRow
                label="兑换人机验证（Cloudflare Turnstile）"
                description="需在 .env 配置 CAPTCHA_SITE_KEY 与 CAPTCHA_SECRET_KEY 后生效；API Key 兑换可跳过"
                checked={form.captchaEnabled}
                onChange={(v) => set("captchaEnabled", v)}
              />
              <ToggleRow
                label="限流失败时拒绝请求"
                checked={form.rateLimitFailClosed}
                onChange={(v) => set("rateLimitFailClosed", v)}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="IP 限流 / 分钟">
                  <Input
                    type="number"
                    value={form.rateLimitIpPerMin}
                    onChange={(e) =>
                      set("rateLimitIpPerMin", Number(e.target.value) || 0)
                    }
                  />
                </FormField>
                <FormField label="编码限流 / 分钟">
                  <Input
                    type="number"
                    value={form.rateLimitCodePerMin}
                    onChange={(e) =>
                      set("rateLimitCodePerMin", Number(e.target.value) || 0)
                    }
                  />
                </FormField>
              </div>
              <FormField
                label="兑换成功 Webhook URL"
                hint="留空关闭。兑换成功后异步 POST JSON（event=redeem.success），失败不影响用户兑换"
              >
                <Input
                  placeholder="https://example.com/hooks/cardkey"
                  value={form.redeemWebhookUrl ?? ""}
                  onChange={(e) => set("redeemWebhookUrl", e.target.value)}
                />
              </FormField>
              <FormField
                label="Webhook 签名密钥"
                hint="可选。请求头 X-CardKey-Signature: sha256=…；留空保存表示不修改已有密钥"
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="可选 HMAC secret"
                  value={form.redeemWebhookSecret ?? ""}
                  onChange={(e) => set("redeemWebhookSecret", e.target.value)}
                />
              </FormField>
            </div>
          </SettingsSection>

          <SettingsSection
            title="API"
            description="密钥轮换与自定义请到「API 密钥」页管理"
          >
            <div className="space-y-3">
              <ToggleRow
                label="开放 API 文档"
                checked={form.apiDocsEnabled}
                onChange={(v) => set("apiDocsEnabled", v)}
              />
              <ToggleRow
                label="兑换页显示文档入口"
                checked={form.showApiDocsEntry}
                onChange={(v) => set("showApiDocsEntry", v)}
              />
              <ToggleRow
                label="文档展示固定兑换密钥"
                checked={form.exposePublicRedeemKeyInDocs}
                onChange={(v) => set("exposePublicRedeemKeyInDocs", v)}
              />
              <p className="text-[11px] text-muted-foreground -mt-1 px-0.5">
                需同时开启「开放 API 文档」才会在公开 /docs 下发密钥；默认关闭。
              </p>
              <FormField
                label="API 路径前缀"
                hint="相对路径，默认 /api/v1"
              >
                <Input
                  value={form.apiBasePath}
                  onChange={(e) => set("apiBasePath", e.target.value)}
                  className="font-mono"
                  placeholder="/api/v1"
                />
              </FormField>
              <FormField
                label="对外 API 地址（Base URL）"
                hint="完整 origin，如 https://api.example.com；留空则文档使用当前站点域名"
              >
                <Input
                  value={form.apiPublicBaseUrl || ""}
                  onChange={(e) => set("apiPublicBaseUrl", e.target.value)}
                  className="font-mono"
                  placeholder="https://your-domain.com"
                />
              </FormField>
              <div className="rounded-lg border border-border/70 bg-secondary/30 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                文档预览：{" "}
                {
                  resolveApiBase({
                    apiBasePath: form.apiBasePath,
                    apiPublicBaseUrl: form.apiPublicBaseUrl,
                  }).redeemUrl
                }
              </div>
            </div>
          </SettingsSection>
        </TabsContent>

        {/* —— 邮件提醒（对齐 sub2api SMTP 表单） —— */}
        <TabsContent value="mail" className="space-y-4">
          <SettingsSection
            title="SMTP 配置"
            description="与 sub2api 类似：填写主机、端口、账号与发件人；465 为隐式 TLS，587 常用 STARTTLS"
            actions={
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={testMailM.isPending}
                onClick={() => {
                  // 先保存再测更稳妥，但允许未保存时用服务端已有配置
                  if (dirty) {
                    m.mutate(form, {
                      onSuccess: (data) => {
                        setForm(data);
                        setBaseline(data);
                        testMailM.mutate(undefined);
                      },
                    });
                  } else {
                    testMailM.mutate(undefined);
                  }
                }}
              >
                {testMailM.isPending ? "测试中…" : "测试连接"}
              </Button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="SMTP 主机">
                <Input
                  value={form.smtpHost || ""}
                  onChange={(e) => set("smtpHost", e.target.value)}
                  placeholder="smtp.example.com"
                  className="font-mono"
                />
              </FormField>
              <FormField label="端口">
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.smtpPort || 587}
                  onChange={(e) =>
                    set("smtpPort", Number(e.target.value) || 587)
                  }
                  placeholder="587"
                />
              </FormField>
              <FormField label="用户名">
                <Input
                  value={form.smtpUsername || ""}
                  onChange={(e) => set("smtpUsername", e.target.value)}
                  placeholder="user@example.com"
                  autoComplete="off"
                />
              </FormField>
              <FormField
                label="密码"
                hint={
                  form.smtpPasswordSet
                    ? "已配置；留空保存则保持原密码不变"
                    : "SMTP 授权码或密码"
                }
              >
                <Input
                  type="password"
                  value={form.smtpPassword || ""}
                  onChange={(e) => set("smtpPassword", e.target.value)}
                  placeholder={
                    form.smtpPasswordSet ? "••••••••（已配置）" : "SMTP 密码"
                  }
                  autoComplete="new-password"
                />
              </FormField>
              <FormField label="发件人邮箱">
                <Input
                  type="email"
                  value={form.smtpFromEmail || ""}
                  onChange={(e) => set("smtpFromEmail", e.target.value)}
                  placeholder="noreply@example.com"
                />
              </FormField>
              <FormField label="发件人名称">
                <Input
                  value={form.smtpFromName || ""}
                  onChange={(e) => set("smtpFromName", e.target.value)}
                  placeholder="CardKey"
                />
              </FormField>
            </div>
            <div className="mt-3 space-y-3">
              <ToggleRow
                label="使用 TLS / STARTTLS"
                description="587 端口建议开启；465 为隐式 TLS"
                checked={!!form.smtpUseTLS}
                onChange={(v) => set("smtpUseTLS", v)}
              />
              {form.smtpUseTLS ? (
                <ToggleRow
                  label="跳过 TLS 证书校验"
                  description="仅内网自签证书时使用，生产不建议开启"
                  checked={!!form.smtpSkipTlsVerify}
                  onChange={(v) => set("smtpSkipTlsVerify", v)}
                />
              ) : null}
            </div>
          </SettingsSection>

          <SettingsSection
            title="发送测试邮件"
            description="验证 SMTP 账号能否真正发信"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <FormField label="收件人" className="min-w-0 flex-1">
                <Input
                  type="email"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="you@example.com"
                />
              </FormField>
              <Button
                type="button"
                disabled={testMailM.isPending || !testTo.trim()}
                onClick={() => {
                  const to = testTo.trim();
                  // 简单校验：须为邮箱，不能是「您好」等昵称
                  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
                    toast.error("请填写有效邮箱，例如 name@qq.com");
                    return;
                  }
                  const send = () => testMailM.mutate(to);
                  if (dirty) {
                    m.mutate(form, {
                      onSuccess: (data) => {
                        setForm(data);
                        setBaseline(data);
                        send();
                      },
                    });
                  } else {
                    send();
                  }
                }}
              >
                {testMailM.isPending ? "发送中…" : "发送测试"}
              </Button>
            </div>
          </SettingsSection>

          <SettingsSection
            title="预警收件人"
            description="平台健康与卡密预警共用收件人列表"
          >
            <FormField
              label="收件邮箱"
              hint="多个地址用逗号或分号分隔"
            >
              <Input
                value={form.mailNotifyTo || ""}
                onChange={(e) => set("mailNotifyTo", e.target.value)}
                placeholder="ops@example.com, admin@example.com"
              />
            </FormField>
            <FormField
              label="同类预警冷却（分钟）"
              hint="防止短时间重复刷信，默认 60"
              className="mt-3 max-w-xs"
            >
              <Input
                type="number"
                min={5}
                value={form.mailAlertCooldownMinutes || 60}
                onChange={(e) =>
                  set(
                    "mailAlertCooldownMinutes",
                    Math.max(5, Number(e.target.value) || 60),
                  )
                }
              />
            </FormField>
          </SettingsSection>

          <SettingsSection
            title="平台健康预警"
            description="独立开关。检测 Postgres / Redis 连通，以及可选的 HTTP 5xx 比例"
          >
            <ToggleRow
              label="启用平台健康预警"
              checked={!!form.mailHealthAlertEnabled}
              onChange={(v) => set("mailHealthAlertEnabled", v)}
            />
            <FormField
              label="5xx 错误率阈值（%）"
              hint="进程累计样本 ≥50 时生效；填 0 则仅检测数据库/Redis 连通"
              className="mt-3 max-w-xs"
            >
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={form.mailHealthErrorRatePct ?? 10}
                onChange={(e) =>
                  set("mailHealthErrorRatePct", Number(e.target.value) || 0)
                }
                disabled={!form.mailHealthAlertEnabled}
              />
            </FormField>
          </SettingsSection>

          <SettingsSection
            title="卡密库存预警"
            description="独立开关。勾选需要监控的类别；可兑库存 ≤ 阈值时发信"
          >
            <ToggleRow
              label="启用卡密库存预警"
              checked={!!form.mailCardAlertEnabled}
              onChange={(v) => set("mailCardAlertEnabled", v)}
            />
            <FormField
              label="可兑库存阈值"
              hint="例如 10：勾选类别剩余 ≤10 张即告警；0 表示仅在耗尽时告警"
              className="mt-3 max-w-xs"
            >
              <Input
                type="number"
                min={0}
                value={form.mailCardUnusedThreshold ?? 10}
                onChange={(e) =>
                  set(
                    "mailCardUnusedThreshold",
                    Math.max(0, Number(e.target.value) || 0),
                  )
                }
                disabled={!form.mailCardAlertEnabled}
              />
            </FormField>
            <FormField
              label="监控类别"
              hint={
                (form.mailCardAlertCategoryIds?.length ?? 0) === 0
                  ? "未勾选 = 监控全部启用类别"
                  : `已选 ${form.mailCardAlertCategoryIds.length} 个类别`
              }
              className="mt-3"
            >
              <div
                className={cn(
                  "max-h-56 space-y-1 overflow-auto rounded-lg border border-border/70 p-2",
                  !form.mailCardAlertEnabled && "opacity-60 pointer-events-none",
                )}
              >
                {catsQ.isLoading ? (
                  <p className="px-1 py-2 text-[11px] text-muted-foreground">
                    加载类别…
                  </p>
                ) : (catsQ.data ?? []).length === 0 ? (
                  <p className="px-1 py-2 text-[11px] text-muted-foreground">
                    暂无类别
                  </p>
                ) : (
                  (catsQ.data ?? []).map((c) => {
                    const ids = form.mailCardAlertCategoryIds ?? [];
                    const on = ids.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                          on
                            ? "bg-secondary/70"
                            : "hover:bg-secondary/40",
                          !c.enabled && "opacity-50",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="size-3.5 accent-primary"
                          checked={on}
                          disabled={!form.mailCardAlertEnabled}
                          onChange={() => {
                            const next = on
                              ? ids.filter((x) => x !== c.id)
                              : [...ids, c.id];
                            set("mailCardAlertCategoryIds", next);
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {c.name}
                        </span>
                        <code className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {c.slug}
                        </code>
                        {!c.enabled ? (
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            已停用
                          </span>
                        ) : null}
                      </label>
                    );
                  })
                )}
              </div>
              {(form.mailCardAlertCategoryIds?.length ?? 0) > 0 ? (
                <button
                  type="button"
                  className="mt-1.5 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                  disabled={!form.mailCardAlertEnabled}
                  onClick={() => set("mailCardAlertCategoryIds", [])}
                >
                  清除勾选（恢复监控全部）
                </button>
              ) : null}
            </FormField>
          </SettingsSection>

          <p className="text-[11px] text-muted-foreground px-1">
            后台约每 5 分钟评估一次预警条件；需已配置 SMTP 与收件人。邮件发送失败会写入服务日志。
          </p>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
