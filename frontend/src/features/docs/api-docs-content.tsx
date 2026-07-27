import { KeyRound } from "lucide-react";
import { useMemo, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PublicConfig } from "@/entities/types";
import { CodeBlock } from "@/shared/components/code-block";
import { SecretField } from "@/shared/components/secret-field";
import { cn } from "@/shared/lib/cn";

type LangId = "curl" | "js" | "python" | "go" | "java" | "php";

const LANGS: { id: LangId; label: string }[] = [
  { id: "curl", label: "cURL" },
  { id: "js", label: "JavaScript" },
  { id: "python", label: "Python" },
  { id: "go", label: "Go" },
  { id: "java", label: "Java" },
  { id: "php", label: "PHP" },
];

/** 解析文档中展示的 API 根地址与完整 redeem URL */
export function resolveApiBase(cfg?: Pick<
  PublicConfig,
  "apiBasePath" | "apiPublicBaseUrl"
> | null) {
  const path = (cfg?.apiBasePath || "/api/v1").replace(/\/$/, "") || "/api/v1";
  const configured = (cfg?.apiPublicBaseUrl || "").replace(/\/$/, "");
  const origin =
    configured ||
    (typeof window !== "undefined" ? window.location.origin : "https://host");
  // apiPublicBaseUrl 可写完整到 host，或已含 path
  let baseRoot = origin;
  let apiPrefix = path;
  if (configured) {
    try {
      const u = new URL(configured);
      // 若配置已带 /api/v1 路径
      if (u.pathname && u.pathname !== "/") {
        baseRoot = `${u.protocol}//${u.host}`;
        apiPrefix = u.pathname.replace(/\/$/, "") || path;
      } else {
        baseRoot = configured;
        apiPrefix = path;
      }
    } catch {
      baseRoot = configured;
    }
  }
  const redeemUrl = `${baseRoot}${apiPrefix}/public/redeem`;
  return { baseRoot, apiPrefix, redeemUrl };
}

type Props = {
  cfg: PublicConfig;
  /** 管理端可强制展示密钥 */
  forceShowKey?: boolean;
  className?: string;
};

export function ApiDocsContent({ cfg, forceShowKey, className }: Props) {
  const [lang, setLang] = useState<LangId>("curl");
  const { baseRoot, apiPrefix, redeemUrl } = resolveApiBase(cfg);

  const showKey = forceShowKey || !!cfg.publicRedeemApiKey;

  const key =
    cfg.publicRedeemApiKey || "ck_xxxxxxxxxxxxxxxxxxxxxxxx";

  const cat = cfg.categories?.[0]?.slug || "vip";
  const codeSample = cfg.categories?.[0]
    ? `${cfg.categories[0].codePrefix}-XXXX-XXXX-XXXX-XXXX`
    : "VIP-XXXX-XXXX-XXXX-XXXX";

  const snippets = useMemo(
    () => buildSnippets({ url: redeemUrl, key, cat, code: codeSample }),
    [redeemUrl, key, cat, codeSample],
  );

  return (
    <div className={cn("space-y-8", className)}>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Base URL</h2>
        <CodeBlock
          lang="text"
          code={`${baseRoot}${apiPrefix}`}
          heightClass="h-16"
        />
        <p className="text-[11px] text-muted-foreground">
          可在「系统设置 → API → 对外 API 地址」配置；留空则使用当前站点域名。
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          POST {apiPrefix}/public/redeem
        </p>
      </section>

      {showKey ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">固定兑换密钥</h2>
          <SecretField
            value={key}
            actions={
              <span className="flex size-8 items-center justify-center text-muted-foreground">
                <KeyRound className="size-3.5" />
              </span>
            }
          />
          <p className="text-[11px] text-muted-foreground">
            Header：Authorization: Bearer {"<密钥>"} · 权限 redeem:api
          </p>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">请求体</h2>
        <CodeBlock
          lang="json"
          code={[
            `{`,
            `  "category": "${cat}",`,
            `  "code": "${codeSample}"`,
            `}`,
          ].join("\n")}
          heightClass="h-40"
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">示例</h2>
        <Tabs value={lang} onValueChange={(v) => setLang(v as LangId)}>
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
            {LANGS.map((l) => (
              <TabsTrigger
                key={l.id}
                value={l.id}
                className={cn(
                  "rounded-full border border-transparent px-3 py-1 text-xs",
                  "data-[state=active]:border-border data-[state=active]:bg-primary data-[state=active]:text-primary-foreground",
                )}
              >
                {l.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {LANGS.map((l) => (
            <TabsContent key={l.id} value={l.id} className="mt-3">
              <CodeBlock
                lang={l.label}
                code={snippets[l.id]}
                heightClass="h-72"
              />
            </TabsContent>
          ))}
        </Tabs>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">成功响应</h2>
        <CodeBlock
          lang="json"
          heightClass="h-56"
          code={[
            `{`,
            `  "success": true,`,
            `  "data": {`,
            `    "status": "success",`,
            `    "category": "${cat}",`,
            `    "code": "…",`,
            `    "type": "text",`,
            `    "content": "…",`,
            `    "redeemedAt": "…"`,
            `  }`,
            `}`,
          ].join("\n")}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">错误码</h2>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-secondary/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">code</th>
                <th className="px-3 py-2 font-medium">HTTP</th>
                <th className="px-3 py-2 font-medium">说明</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["RATE_LIMITED", "429", "限流"],
                ["CARD_INVALID", "404", "无效"],
                ["CARD_USED", "409", "已兑换"],
                ["CARD_EXPIRED", "410", "已过期"],
                ["UNAUTHORIZED", "401", "密钥无效"],
              ].map(([code, http, msg]) => (
                <tr key={code} className="border-t border-border/60">
                  <td className="px-3 py-2 font-mono">{code}</td>
                  <td className="px-3 py-2 text-muted-foreground">{http}</td>
                  <td className="px-3 py-2 text-muted-foreground">{msg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function buildSnippets(p: {
  url: string;
  key: string;
  cat: string;
  code: string;
}): Record<LangId, string> {
  const body = JSON.stringify({ category: p.cat, code: p.code }, null, 2);
  const bodyOneLine = JSON.stringify({ category: p.cat, code: p.code });
  const bodyIndented = body
    .split("\n")
    .map((line, i) => (i === 0 ? line : `  ${line}`))
    .join("\n");

  return {
    curl: [
      `curl -X POST '${p.url}' \\`,
      `  -H 'Content-Type: application/json' \\`,
      `  -H 'Authorization: Bearer ${p.key}' \\`,
      `  -d '${bodyOneLine}'`,
    ].join("\n"),
    js: [
      `const res = await fetch("${p.url}", {`,
      `  method: "POST",`,
      `  headers: {`,
      `    "Content-Type": "application/json",`,
      `    Authorization: "Bearer ${p.key}",`,
      `  },`,
      `  body: JSON.stringify({`,
      `    category: "${p.cat}",`,
      `    code: "${p.code}",`,
      `  }),`,
      `});`,
      `const data = await res.json();`,
      `console.log(data);`,
    ].join("\n"),
    python: [
      `import requests`,
      ``,
      `resp = requests.post(`,
      `    "${p.url}",`,
      `    headers={`,
      `        "Content-Type": "application/json",`,
      `        "Authorization": "Bearer ${p.key}",`,
      `    },`,
      `    json={`,
      `        "category": "${p.cat}",`,
      `        "code": "${p.code}",`,
      `    },`,
      `    timeout=15,`,
      `)`,
      `print(resp.json())`,
    ].join("\n"),
    go: [
      `package main`,
      ``,
      `import (`,
      `  "bytes"`,
      `  "net/http"`,
      `)`,
      ``,
      `func main() {`,
      `  body := []byte(\`${bodyIndented}\`)`,
      `  req, _ := http.NewRequest(http.MethodPost, "${p.url}", bytes.NewReader(body))`,
      `  req.Header.Set("Content-Type", "application/json")`,
      `  req.Header.Set("Authorization", "Bearer ${p.key}")`,
      `  resp, err := http.DefaultClient.Do(req)`,
      `  _ = resp`,
      `  _ = err`,
      `}`,
    ].join("\n"),
    java: [
      `HttpRequest request = HttpRequest.newBuilder()`,
      `    .uri(URI.create("${p.url}"))`,
      `    .header("Content-Type", "application/json")`,
      `    .header("Authorization", "Bearer ${p.key}")`,
      `    .POST(HttpRequest.BodyPublishers.ofString("""`,
      `${body}`,
      `"""))`,
      `    .build();`,
      `HttpResponse<String> response = HttpClient.newHttpClient()`,
      `    .send(request, HttpResponse.BodyHandlers.ofString());`,
      `System.out.println(response.body());`,
    ].join("\n"),
    php: [
      `<?php`,
      `$ch = curl_init("${p.url}");`,
      `curl_setopt_array($ch, [`,
      `  CURLOPT_POST => true,`,
      `  CURLOPT_HTTPHEADER => [`,
      `    "Content-Type: application/json",`,
      `    "Authorization: Bearer ${p.key}",`,
      `  ],`,
      `  CURLOPT_POSTFIELDS => '${bodyOneLine}',`,
      `  CURLOPT_RETURNTRANSFER => true,`,
      `]);`,
      `echo curl_exec($ch);`,
    ].join("\n"),
  };
}
