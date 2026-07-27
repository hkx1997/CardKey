import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Settings } from "@/entities/types";
import { FormField } from "@/shared/components/form-field";
import { ImageUploadField } from "@/shared/components/image-upload-field";
import { LoadingBlock } from "@/shared/components/loading-block";
import { PageContainer } from "@/shared/components/page-container";
import { PageHeader } from "@/shared/components/page-header";
import { SettingsSection } from "@/shared/components/settings-section";
import { ToggleRow } from "@/shared/components/toggle-row";
import {
  useSettingsQuery,
  useUpdateSettings,
} from "@/shared/hooks/use-settings";
import { resolveApiBase } from "@/shared/lib/api-base";

export function SettingsPage() {
  const q = useSettingsQuery();
  const m = useUpdateSettings();
  const [form, setForm] = useState<Settings | null>(null);
  const [baseline, setBaseline] = useState<Settings | null>(null);

  useEffect(() => {
    // 仅在无本地未保存改动时用服务端数据刷新，避免冲掉编辑中表单
    if (!q.data) return;
    if (!form || !baseline) {
      setForm(q.data);
      setBaseline(q.data);
      return;
    }
    const isDirty = JSON.stringify(form) !== JSON.stringify(baseline);
    if (!isDirty) {
      setForm(q.data);
      setBaseline(q.data);
    }
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps -- 故意只跟服务端数据

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

  return (
    <PageContainer>
      <PageHeader
        title="系统设置"
        description={
          dirty
            ? "品牌、兑换页、安全与 API · 有未保存的更改"
            : "品牌、兑换页、安全与 API 全局配置"
        }
        actions={
          <Button
            className="interactive-press"
            disabled={m.isPending || !dirty}
            onClick={() =>
              m.mutate(form, {
                onSuccess: (data) => {
                  setForm(data);
                  setBaseline(data);
                },
              })
            }
          >
            {m.isPending ? "保存中…" : dirty ? "保存" : "已保存"}
          </Button>
        }
      />

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
            label="验证码（预留，暂未接入兑换页）"
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
    </PageContainer>
  );
}
