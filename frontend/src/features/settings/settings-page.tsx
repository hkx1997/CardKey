import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Settings } from "@/entities/types";
import { resolveApiBase } from "@/features/docs/api-docs-content";
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

export function SettingsPage() {
  const q = useSettingsQuery();
  const m = useUpdateSettings();
  const [form, setForm] = useState<Settings | null>(null);

  useEffect(() => {
    if (q.data) setForm(q.data);
  }, [q.data]);

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
        description="品牌、兑换页、安全与 API 全局配置"
        actions={
          <Button
            className="interactive-press"
            disabled={m.isPending}
            onClick={() =>
              m.mutate(form, {
                onSuccess: (data) => setForm(data),
              })
            }
          >
            保存
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
              hint="支持 PNG/JPEG/WebP/SVG/ICO，最大 2MB；也可填外链 URL"
            />
          </FormField>
          <FormField label="Favicon" className="sm:col-span-2">
            <ImageUploadField
              value={form.siteFavicon}
              onChange={(v) => set("siteFavicon", v)}
              hint="浏览器标签图标，建议正方形"
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
            label="验证码"
            checked={form.captchaEnabled}
            onChange={(v) => set("captchaEnabled", v)}
          />
          <ToggleRow
            label="限流失败关闭"
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
            label="文档展示固定密钥"
            checked={form.exposePublicRedeemKeyInDocs}
            onChange={(v) => set("exposePublicRedeemKeyInDocs", v)}
          />
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
