import { KeyRound } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PublicConfig } from "@/entities/types";
import {
  ADMIN_API_ENDPOINTS,
  ADMIN_AUTH_ENDPOINTS,
  expandPath,
  PUBLIC_OPS_ENDPOINTS,
  REDEEM_ENDPOINTS,
  type ApiEndpoint,
} from "@/features/docs/api-endpoints";
import { CodeBlock } from "@/shared/components/code-block";
import { SecretField } from "@/shared/components/secret-field";
import { resolveApiBase } from "@/shared/lib/api-base";
import { cn } from "@/shared/lib/cn";

export { resolveApiBase } from "@/shared/lib/api-base";

type LangId = "curl" | "js" | "python" | "go" | "java" | "php";
export type DocsScope = "public" | "admin";

const LANGS: { id: LangId; label: string }[] = [
  { id: "curl", label: "cURL" },
  { id: "js", label: "JavaScript" },
  { id: "python", label: "Python" },
  { id: "go", label: "Go" },
  { id: "java", label: "Java" },
  { id: "php", label: "PHP" },
];

const METHOD_CLASS: Record<string, string> = {
  GET: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  POST: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  PUT: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  PATCH: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  DELETE: "bg-red-500/15 text-red-700 dark:text-red-400",
};

/** 公开文档用：无 scope / 管理端话术 */
const PUBLIC_REDEEM_ROWS: ApiEndpoint[] = [
  {
    method: "GET",
    path: "{prefix}/public/config",
    auth: "无需",
    desc: "站点配置与启用中的类别",
  },
  {
    method: "GET",
    path: "{prefix}/public/category-stock",
    auth: "无需",
    desc: "各类别可兑换库存（支持缓存）",
  },
  {
    method: "POST",
    path: "{prefix}/public/redeem",
    auth: "一般无需；若站点开启密钥校验则带 Bearer",
    desc: "兑换卡密，返回内容与元数据",
    body: '{ "category": "slug", "code": "XXX-..." }',
  },
];

function EndpointTable({
  title,
  items,
  prefix,
  id,
  subtitle,
  showAuth = true,
}: {
  title: string;
  items: ApiEndpoint[];
  prefix: string;
  id?: string;
  subtitle?: string;
  /** 公开文档可隐藏鉴权列，减少噪声 */
  showAuth?: boolean;
}) {
  return (
    <section id={id} className="scroll-mt-20 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <Badge variant="secondary" className="text-[10px] tabular-nums">
          {items.length} 个接口
        </Badge>
      </div>
      {subtitle ? (
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-border shadow-sm">
        <table
          className={cn(
            "w-full text-left text-xs",
            showAuth ? "min-w-[720px]" : "min-w-[560px]",
          )}
        >
          <thead className="bg-secondary/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 font-medium w-20">方法</th>
              <th className="px-3 py-2.5 font-medium">路径</th>
              {showAuth ? (
                <th className="px-3 py-2.5 font-medium w-36">鉴权</th>
              ) : null}
              <th className="px-3 py-2.5 font-medium">说明</th>
            </tr>
          </thead>
          <tbody>
            {items.map((ep) => {
              const full = expandPath(ep.path, prefix);
              return (
                <tr
                  key={`${ep.method}-${full}`}
                  className="border-t border-border/60 align-top hover:bg-secondary/20"
                >
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        "inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                        METHOD_CLASS[ep.method] ?? "bg-secondary",
                      )}
                    >
                      {ep.method}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <code className="break-all font-mono text-[11px] text-foreground">
                      {full}
                    </code>
                    {ep.query ? (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        Query: {ep.query}
                      </p>
                    ) : null}
                    {ep.body ? (
                      <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
                        Body: {ep.body}
                      </p>
                    ) : null}
                  </td>
                  {showAuth ? (
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {ep.auth}
                    </td>
                  ) : null}
                  <td className="px-3 py-2.5 text-muted-foreground">{ep.desc}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type Props = {
  cfg: PublicConfig;
  /** public=兑换端文档；admin=管理端完整文档 */
  scope?: DocsScope;
  forceShowKey?: boolean;
  className?: string;
};

export function ApiDocsContent({
  cfg,
  scope = "public",
  forceShowKey,
  className,
}: Props) {
  const [lang, setLang] = useState<LangId>("curl");
  const { baseRoot, apiPrefix, redeemUrl } = resolveApiBase(cfg);

  const isAdmin = scope === "admin";
  const showKey = forceShowKey || !!cfg.publicRedeemApiKey;
  const key =
    cfg.publicRedeemApiKey || "ck_xxxxxxxxxxxxxxxxxxxxxxxx";

  const cat = cfg.categories?.[0]?.slug || "vip";
  const codeSample = cfg.categories?.[0]
    ? `${cfg.categories[0].codePrefix}-XXXX-XXXX-XXXX-XXXX`
    : "VIP-XXXX-XXXX-XXXX-XXXX";

  const snippets = useMemo(
    () =>
      buildSnippets({
        url: redeemUrl,
        key,
        cat,
        code: codeSample,
        // 公开文档：仅在展示密钥时带 Authorization
        withAuth: isAdmin || showKey,
      }),
    [redeemUrl, key, cat, codeSample, isAdmin, showKey],
  );

  const adminTotal =
    ADMIN_AUTH_ENDPOINTS.length + ADMIN_API_ENDPOINTS.length;

  const publicErrors = [
    ["RATE_LIMITED", "429", "请求过于频繁"],
    ["CARD_INVALID", "404", "卡密无效"],
    ["CARD_USED", "409", "已被兑换"],
    ["CARD_EXPIRED", "410", "已过期"],
    ["UNAUTHORIZED", "401", "密钥无效（若开启校验）"],
    ["VALIDATION_ERROR", "400", "参数错误"],
  ] as const;

  const adminErrors = [
    ["RATE_LIMITED", "429", "限流"],
    ["CARD_INVALID", "404", "无效"],
    ["CARD_USED", "409", "已兑换"],
    ["CARD_EXPIRED", "410", "已过期"],
    ["UNAUTHORIZED", "401", "密钥/登录无效"],
    ["FORBIDDEN", "403", "权限不足 / 需先改密"],
    ["VALIDATION_ERROR", "400", "参数错误"],
    ["CONFLICT", "409", "冲突（如类别不可删）"],
    ["NOT_FOUND", "404", "资源不存在"],
  ] as const;

  return (
    <div className={cn("space-y-8", className)}>
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium">Base URL</h2>
          {isAdmin ? (
            <Badge variant="outline" className="font-mono text-[10px]">
              管理端 · 完整 API
            </Badge>
          ) : null}
        </div>
        {/* 仅 origin：路径里已含 /api/v1 等前缀，勿再拼进 Base URL */}
        <CodeBlock lang="text" code={baseRoot} heightClass="h-16" />
        <p className="text-[11px] text-muted-foreground">
          {isAdmin ? (
            <>
              可在「系统设置 → API → 对外 API 地址」配置 origin；留空则用当前站点域名。
              完整请求地址 ={" "}
              <code className="font-mono">Base URL</code> + 下表路径（路径已含前缀{" "}
              <code className="font-mono">{apiPrefix}</code>
              ）。
            </>
          ) : (
            <>
              完整地址 = Base URL + 路径，例如{" "}
              <code className="font-mono">
                {baseRoot}
                {apiPrefix}/public/redeem
              </code>
            </>
          )}
        </p>
      </section>

      {isAdmin ? (
        <section className="space-y-1.5 rounded-lg border border-border/70 bg-secondary/30 px-3 py-2.5 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">权限边界</p>
          <p>
            · <strong className="text-foreground">兑换端</strong>（scope{" "}
            <code className="font-mono">redeem:api</code>
            ）：仅{" "}
            <code className="font-mono">{apiPrefix}/public/config</code>、
            <code className="font-mono">
              {apiPrefix}/public/category-stock
            </code>
            、
            <code className="font-mono">{apiPrefix}/public/redeem</code>
            。系统固定兑换密钥仅有此权限。
          </p>
          <p>
            · <strong className="text-foreground">管理端</strong>（Cookie JWT 或
            scope <code className="font-mono">admin:api</code>
            ）：全部{" "}
            <code className="font-mono">{apiPrefix}/admin/*</code>
            ；
            <code className="font-mono">admin:api</code> 可覆盖兑换权限。
          </p>
          <p>
            · 浏览器管理台：Cookie{" "}
            <code className="font-mono">cardkey_token</code>
            ；脚本：{" "}
            <code className="font-mono">
              Authorization: Bearer &lt;API_KEY&gt;
            </code>
          </p>
          <p>
            · 统一响应：{" "}
            <code className="font-mono">
              {`{ "success": true, "data": ... }`}
            </code>{" "}
            或{" "}
            <code className="font-mono">
              {`{ "success": false, "error": { "code", "message" } }`}
            </code>
          </p>
        </section>
      ) : (
        <section className="space-y-1 rounded-lg border border-border/70 bg-secondary/30 px-3 py-2.5 text-[11px] text-muted-foreground">
          <p>
            响应统一为{" "}
            <code className="font-mono text-foreground">
              {`{ "success": true, "data": … }`}
            </code>{" "}
            或{" "}
            <code className="font-mono text-foreground">
              {`{ "success": false, "error": { "code", "message" } }`}
            </code>
          </p>
          <p>
            若站点开启了密钥校验，在请求头加上{" "}
            <code className="font-mono text-foreground">
              Authorization: Bearer &lt;密钥&gt;
            </code>
          </p>
        </section>
      )}

      <nav className="flex flex-wrap gap-2 text-[11px]">
        <a
          href="#endpoints-redeem"
          className="rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          {isAdmin ? `兑换端 · ${REDEEM_ENDPOINTS.length}` : "接口列表"}
        </a>
        {isAdmin ? (
          <>
            <a
              href="#endpoints-ops"
              className="rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              安装/运维 · {PUBLIC_OPS_ENDPOINTS.length}
            </a>
            <a
              href="#endpoints-admin-auth"
              className="rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              认证与系统 · {ADMIN_AUTH_ENDPOINTS.length}
            </a>
            <a
              href="#endpoints-admin-api"
              className="rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              管理业务 · {ADMIN_API_ENDPOINTS.length}
            </a>
            <a
              href="#admin-create-card"
              className="rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              创建卡密 · 多类型
            </a>
          </>
        ) : null}
        <a
          href="#redeem-detail"
          className="rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          兑换示例
        </a>
        {isAdmin ? (
          <span className="self-center text-muted-foreground/80">
            管理 {adminTotal} · 兑换 {REDEEM_ENDPOINTS.length} · 运维{" "}
            {PUBLIC_OPS_ENDPOINTS.length}
          </span>
        ) : null}
      </nav>

      <EndpointTable
        id="endpoints-redeem"
        title={isAdmin ? "兑换端接口" : "接口列表"}
        subtitle={
          isAdmin
            ? "仅兑换相关；scope=redeem:api 可调用（若强制密钥）"
            : undefined
        }
        items={isAdmin ? REDEEM_ENDPOINTS : PUBLIC_REDEEM_ROWS}
        prefix={apiPrefix}
        showAuth={isAdmin}
      />
      {isAdmin ? (
        <>
          <EndpointTable
            id="endpoints-ops"
            title="安装 / 运维（非兑换业务）"
            subtitle="健康检查、首次安装等；不属于兑换 API 权限范围"
            items={PUBLIC_OPS_ENDPOINTS}
            prefix={apiPrefix}
          />
          <EndpointTable
            id="endpoints-admin-auth"
            title="管理端 · 认证与系统"
            subtitle="Cookie JWT 会话"
            items={ADMIN_AUTH_ENDPOINTS}
            prefix={apiPrefix}
          />
          <EndpointTable
            id="endpoints-admin-api"
            title="管理端 · 业务接口"
            subtitle="JWT 会话 或 Bearer scope=admin:api"
            items={ADMIN_API_ENDPOINTS}
            prefix={apiPrefix}
          />

          <section
            id="admin-create-card"
            className="scroll-mt-20 space-y-3 border-t border-border/60 pt-6"
          >
            <h2 className="text-base font-semibold">管理端 · 创建卡密（多类型）</h2>
            <p className="text-xs text-muted-foreground">
              POST {apiPrefix}/admin/cards · 需 Cookie JWT 或{" "}
              <code className="font-mono">admin:api</code> Bearer · 内容 ≤5MB
            </p>
            <h3 className="text-sm font-medium">1) JSON · 文本</h3>
            <CodeBlock
              lang="bash"
              heightClass="h-40"
              code={[
                `curl -X POST '${baseRoot}${apiPrefix}/admin/cards' \\`,
                `  -H 'Authorization: Bearer <ADMIN_API_KEY>' \\`,
                `  -H 'Content-Type: application/json' \\`,
                `  -d '{`,
                `    "categoryId": "<uuid>",`,
                `    "type": "text",`,
                `    "content": "权益内容",`,
                `    "contentEncoding": "utf8",`,
                `    "note": ""`,
                `  }'`,
              ].join("\n")}
            />
            <h3 className="text-sm font-medium">2) JSON · 文件（Base64）</h3>
            <CodeBlock
              lang="bash"
              heightClass="h-48"
              code={[
                `# content 为标准 Base64（不要 data: 前缀）`,
                `B64=$(base64 -w0 package.zip)  # macOS: base64 -i package.zip`,
                `curl -X POST '${baseRoot}${apiPrefix}/admin/cards' \\`,
                `  -H 'Authorization: Bearer <ADMIN_API_KEY>' \\`,
                `  -H 'Content-Type: application/json' \\`,
                `  -d "{`,
                `    \\"categoryId\\": \\"<uuid>\\",`,
                `    \\"type\\": \\"zip\\",`,
                `    \\"content\\": \\"$B64\\",`,
                `    \\"contentEncoding\\": \\"base64\\",`,
                `    \\"filename\\": \\"package.zip\\",`,
                `    \\"mime\\": \\"application/zip\\"`,
                `  }"`,
              ].join("\n")}
            />
            <h3 className="text-sm font-medium">3) multipart · 上传文件（推荐）</h3>
            <CodeBlock
              lang="bash"
              heightClass="h-36"
              code={[
                `curl -X POST '${baseRoot}${apiPrefix}/admin/cards' \\`,
                `  -H 'Authorization: Bearer <ADMIN_API_KEY>' \\`,
                `  -F 'categoryId=<uuid>' \\`,
                `  -F 'type=file' \\`,
                `  -F 'note=发货附件' \\`,
                `  -F 'file=@./package.zip'`,
              ].join("\n")}
            />
            <p className="text-[11px] text-muted-foreground">
              type：text | txt | json | account | image | zip | pdf | file。
              批量导入仅支持文本类；二进制请用本接口单条创建。
            </p>
          </section>
        </>
      ) : null}

      <section
        id="redeem-detail"
        className={cn(
          "scroll-mt-20 space-y-2",
          isAdmin && "border-t border-border/60 pt-6",
        )}
      >
        <h2 className="text-base font-semibold">
          {isAdmin ? "兑换接口详解" : "兑换示例"}
        </h2>
        <p className="font-mono text-xs text-muted-foreground">
          POST {apiPrefix}/public/redeem
        </p>
      </section>

      {showKey ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">
            {isAdmin ? "固定兑换密钥" : "API 密钥"}
          </h2>
          <SecretField
            value={key}
            actions={
              <span className="flex size-8 items-center justify-center text-muted-foreground">
                <KeyRound className="size-3.5" />
              </span>
            }
          />
          <p className="text-[11px] text-muted-foreground">
            {isAdmin ? (
              <>
                Header：Authorization: Bearer {"<密钥>"} · 权限{" "}
                <code className="font-mono">redeem:api</code>
                （无法调用管理接口）
              </>
            ) : (
              <>
                请求头：{" "}
                <code className="font-mono">
                  Authorization: Bearer {"<密钥>"}
                </code>
              </>
            )}
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
        <h2 className="text-sm font-medium">成功响应（文本类）</h2>
        <CodeBlock
          lang="json"
          heightClass="h-56"
          code={[
            `{`,
            `  "success": true,`,
            `  "data": {`,
            `    "status": "success",`,
            `    "category": "${cat}",`,
            `    "categoryName": "…",`,
            `    "code": "…",`,
            `    "type": "text",`,
            `    "content": "卡密明文或 JSON 字符串",`,
            `    "contentEncoding": "utf8",`,
            `    "filename": "….txt",`,
            `    "mime": "text/plain; charset=utf-8",`,
            `    "size": 12,`,
            `    "redeemedAt": "2026-01-01T00:00:00Z"`,
            `  }`,
            `}`,
          ].join("\n")}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">成功响应（二进制：图片 / 压缩包 / PDF / 文件）</h2>
        <p className="text-[11px] text-muted-foreground">
          <code className="font-mono">contentEncoding</code> 为{" "}
          <code className="font-mono">base64</code> 时，
          <code className="font-mono">content</code>{" "}
          为 Base64 原文（无 data: 前缀）。客户端解码后按{" "}
          <code className="font-mono">filename</code> /{" "}
          <code className="font-mono">mime</code> 保存即可。
        </p>
        <CodeBlock
          lang="json"
          heightClass="h-64"
          code={[
            `{`,
            `  "success": true,`,
            `  "data": {`,
            `    "status": "success",`,
            `    "category": "${cat}",`,
            `    "code": "…",`,
            `    "type": "zip",`,
            `    "content": "UEsDB…（base64）",`,
            `    "contentEncoding": "base64",`,
            `    "filename": "package.zip",`,
            `    "mime": "application/zip",`,
            `    "size": 20480,`,
            `    "redeemedAt": "…"`,
            `  }`,
            `}`,
          ].join("\n")}
        />
        <CodeBlock
          lang="javascript"
          heightClass="h-40"
          code={[
            `// 浏览器下载示例`,
            `const { content, contentEncoding, filename, mime } = data;`,
            `const bin = contentEncoding === "base64"`,
            `  ? Uint8Array.from(atob(content), c => c.charCodeAt(0))`,
            `  : new TextEncoder().encode(content);`,
            `const a = document.createElement("a");`,
            `a.href = URL.createObjectURL(new Blob([bin], { type: mime }));`,
            `a.download = filename || "download";`,
            `a.click();`,
          ].join("\n")}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">内容类型 type</h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead className="bg-secondary/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">type</th>
                <th className="px-3 py-2 font-medium">encoding</th>
                <th className="px-3 py-2 font-medium">说明</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["text / txt / account", "utf8", "纯文本、账号类"],
                ["json", "utf8", "合法 JSON 字符串"],
                ["image", "base64", "图片，可预览"],
                ["zip", "base64", "压缩包"],
                ["pdf", "base64", "PDF"],
                ["file", "base64", "任意文件 ≤5MB"],
              ].map(([t, enc, msg]) => (
                <tr key={t} className="border-t border-border/60">
                  <td className="px-3 py-2 font-mono">{t}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    {enc}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{msg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
              {(isAdmin ? adminErrors : publicErrors).map(
                ([code, http, msg]) => (
                  <tr key={code} className="border-t border-border/60">
                    <td className="px-3 py-2 font-mono">{code}</td>
                    <td className="px-3 py-2 text-muted-foreground">{http}</td>
                    <td className="px-3 py-2 text-muted-foreground">{msg}</td>
                  </tr>
                ),
              )}
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
  withAuth?: boolean;
}): Record<LangId, string> {
  const body = JSON.stringify({ category: p.cat, code: p.code }, null, 2);
  const bodyOneLine = JSON.stringify({ category: p.cat, code: p.code });
  const bodyIndented = body
    .split("\n")
    .map((line, i) => (i === 0 ? line : `  ${line}`))
    .join("\n");
  const auth = !!p.withAuth;

  return {
    curl: [
      `curl -X POST '${p.url}' \\`,
      `  -H 'Content-Type: application/json' \\`,
      ...(auth ? [`  -H 'Authorization: Bearer ${p.key}' \\`] : []),
      `  -d '${bodyOneLine}'`,
    ].join("\n"),
    js: [
      `const res = await fetch("${p.url}", {`,
      `  method: "POST",`,
      `  headers: {`,
      `    "Content-Type": "application/json",`,
      ...(auth ? [`    Authorization: "Bearer ${p.key}",`] : []),
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
      ...(auth
        ? [`        "Authorization": "Bearer ${p.key}",`]
        : []),
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
      ...(auth
        ? [`  req.Header.Set("Authorization", "Bearer ${p.key}")`]
        : []),
      `  resp, err := http.DefaultClient.Do(req)`,
      `  _ = resp`,
      `  _ = err`,
      `}`,
    ].join("\n"),
    java: [
      `HttpRequest request = HttpRequest.newBuilder()`,
      `    .uri(URI.create("${p.url}"))`,
      `    .header("Content-Type", "application/json")`,
      ...(auth
        ? [`    .header("Authorization", "Bearer ${p.key}")`]
        : []),
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
      ...(auth ? [`    "Authorization: Bearer ${p.key}",`] : []),
      `  ],`,
      `  CURLOPT_POSTFIELDS => '${bodyOneLine}',`,
      `  CURLOPT_RETURNTRANSFER => true,`,
      `]);`,
      `echo curl_exec($ch);`,
    ].join("\n"),
  };
}
