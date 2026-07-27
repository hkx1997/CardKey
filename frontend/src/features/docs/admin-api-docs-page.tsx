import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { ApiDocsContent } from "@/features/docs/api-docs-content";
import type { PublicConfig } from "@/entities/types";
import { PageContainer } from "@/shared/components/page-container";
import { PageHeader } from "@/shared/components/page-header";
import { LoadingBlock } from "@/shared/components/loading-block";
import { usePublicConfigQuery } from "@/shared/hooks/use-public-config";
import { useSettingsQuery } from "@/shared/hooks/use-settings";

/** 管理端 API 文档（始终可看密钥） */
export function AdminApiDocsPage() {
  const configQ = usePublicConfigQuery();
  const settingsQ = useSettingsQuery();

  if (configQ.isLoading || settingsQ.isLoading) {
    return (
      <PageContainer>
        <PageHeader title="API 文档" />
        <LoadingBlock rows={5} />
      </PageContainer>
    );
  }

  const cfg = configQ.data;
  const s = settingsQ.data;
  if (!cfg) {
    return (
      <PageContainer>
        <PageHeader title="API 文档" description="无法加载配置" />
      </PageContainer>
    );
  }

  const merged: PublicConfig = {
    ...cfg,
    apiBasePath: s?.apiBasePath || cfg.apiBasePath,
    apiPublicBaseUrl: s?.apiPublicBaseUrl || cfg.apiPublicBaseUrl || "",
    publicRedeemApiKey:
      s?.publicRedeemApiKey || cfg.publicRedeemApiKey || null,
  };

  return (
    <PageContainer className="fade-in">
      <PageHeader
        title="API 文档"
        description="管理端完整文档 · 含 Base URL 与固定兑换密钥"
        actions={
          cfg.apiDocsEnabled ? (
            <Button variant="outline" size="sm" asChild>
              <Link to="/docs" target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" />
                公开文档
              </Link>
            </Button>
          ) : null
        }
      />
      <ApiDocsContent cfg={merged} forceShowKey />
    </PageContainer>
  );
}
