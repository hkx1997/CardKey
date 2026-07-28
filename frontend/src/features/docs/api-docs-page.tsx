import { ArrowLeft } from "lucide-react";
import { Link, Navigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { ApiDocsContent } from "@/features/docs/api-docs-content";
import { PageContainer } from "@/shared/components/page-container";
import { SiteBrand } from "@/shared/components/site-brand";
import { ThemeToggleButton } from "@/shared/components/theme-toggle-button";
import { usePublicConfigQuery } from "@/shared/hooks/use-public-config";

/** 公开 API 文档（/docs） */
export function ApiDocsPage() {
  const configQ = usePublicConfigQuery();
  const cfg = configQ.data;

  if (configQ.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        …
      </div>
    );
  }

  if (!cfg?.apiDocsEnabled) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border/50 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-5">
          <SiteBrand name={cfg.siteName} logo={cfg.siteLogo} />
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild className="text-xs">
              <Link to="/">
                <ArrowLeft className="size-3.5" />
                兑换
              </Link>
            </Button>
            <ThemeToggleButton />
          </div>
        </div>
      </header>

      <PageContainer narrow className="fade-in">
        <h1 className="text-2xl font-semibold tracking-tight">兑换端 API 文档</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          仅兑换相关接口（config / 库存 / redeem）· 权限 redeem:api · 不含管理接口
        </p>
        <div className="mt-8">
          <ApiDocsContent cfg={cfg} scope="public" />
        </div>
      </PageContainer>
    </div>
  );
}
