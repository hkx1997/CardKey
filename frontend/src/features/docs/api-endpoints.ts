/** API 接口清单 — 与 backend/internal/server/server.go 保持同步
 *
 * 权限边界：
 * - 兑换端：仅 /public/* 兑换相关（config / stock / redeem）+ 静态资源
 * - 管理端：/admin/* 全部（Cookie JWT 或 Bearer scope=admin:api）
 * - 系统兑换密钥仅 redeem:api，无法访问管理接口
 */

export type ApiEndpoint = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  auth: string;
  desc: string;
  body?: string;
  query?: string;
};

/**
 * 兑换端 API（公开文档 /docs 只展示这些）
 * 鉴权：无，或 REQUIRE_REDEEM_API_KEY 时 Bearer + scope redeem:api
 */
export const REDEEM_ENDPOINTS: ApiEndpoint[] = [
  {
    method: "GET",
    path: "{prefix}/public/config",
    auth: "无",
    desc: "兑换站配置、启用类别、限流提示等（库存字段可能随轮询接口更新）",
  },
  {
    method: "GET",
    path: "{prefix}/public/category-stock",
    auth: "无",
    desc: "各类别可兑库存快照；支持 ETag / 304；兑换页轮询用",
  },
  {
    method: "POST",
    path: "{prefix}/public/redeem",
    auth: "无 或 Bearer redeem:api",
    desc: "兑换卡密。返回 content；二进制含 contentEncoding=base64、filename、mime、size",
    body: '{ "category": "slug", "code": "XXX-..." }',
  },
  {
    method: "GET",
    path: "/uploads/*",
    auth: "无",
    desc: "站点 Logo / 图标等静态资源（兑换页展示用）",
  },
];

/** 公开运维 / 安装（管理端文档可见；不属于兑换业务 API） */
export const PUBLIC_OPS_ENDPOINTS: ApiEndpoint[] = [
  {
    method: "GET",
    path: "/healthz",
    auth: "无",
    desc: "存活检查（含 version）",
  },
  {
    method: "GET",
    path: "/readyz",
    auth: "无",
    desc: "就绪检查（DB/Redis）",
  },
  {
    method: "GET",
    path: "/metrics",
    auth: "METRICS_TOKEN（若已配置）",
    desc: "Prometheus 文本指标",
  },
  {
    method: "GET",
    path: "{prefix}/public/setup-status",
    auth: "无",
    desc: "是否需要首次安装向导",
  },
  {
    method: "POST",
    path: "{prefix}/public/setup",
    auth: "无（仅无管理员时）",
    desc: "完成首次安装：创建管理员",
    body: '{ "username", "password", "confirmPassword?", "siteName?", "seedDemoCategories?" }',
  },
];

/** @deprecated 使用 REDEEM_ENDPOINTS + PUBLIC_OPS_ENDPOINTS；保留别名避免旧引用 */
export const PUBLIC_ENDPOINTS: ApiEndpoint[] = [
  ...REDEEM_ENDPOINTS,
  ...PUBLIC_OPS_ENDPOINTS,
];

/** 管理端认证相关 */
export const ADMIN_AUTH_ENDPOINTS: ApiEndpoint[] = [
  {
    method: "POST",
    path: "{prefix}/admin/auth/login",
    auth: "无",
    desc: "管理员登录（Set-Cookie JWT）",
    body: '{ "username", "password" }',
  },
  {
    method: "POST",
    path: "{prefix}/admin/auth/logout",
    auth: "Cookie/Bearer",
    desc: "登出并吊销 JWT",
  },
  {
    method: "GET",
    path: "{prefix}/admin/auth/me",
    auth: "管理员",
    desc: "当前登录用户",
  },
  {
    method: "POST",
    path: "{prefix}/admin/auth/change-password",
    auth: "管理员",
    desc: "修改密码",
    body: '{ "old_password", "new_password" }',
  },
  {
    method: "GET",
    path: "{prefix}/admin/system/info",
    auth: "管理员",
    desc: "版本、构建信息、更新模式",
  },
];

/** 管理端业务 API（Cookie JWT，或 Bearer API Key 且 scope 含 admin:api） */
export const ADMIN_API_ENDPOINTS: ApiEndpoint[] = [
  {
    method: "GET",
    path: "{prefix}/admin/dashboard/stats",
    auth: "JWT / admin:api",
    desc: "仪表盘统计",
    query: "category?",
  },
  {
    method: "GET",
    path: "{prefix}/admin/dashboard/runtime",
    auth: "JWT / admin:api",
    desc: "运行时流量/并发/延迟/连接池（短轮询）",
  },
  {
    method: "GET",
    path: "{prefix}/admin/categories",
    auth: "JWT / admin:api",
    desc: "类别列表",
  },
  {
    method: "POST",
    path: "{prefix}/admin/categories",
    auth: "JWT / admin:api",
    desc: "创建类别",
    body: '{ "name", "slug", "codePrefix", "description?", "icon?" }',
  },
  {
    method: "PATCH",
    path: "{prefix}/admin/categories/{id}",
    auth: "JWT / admin:api",
    desc: "更新类别（名称/描述/启用/图标等）",
  },
  {
    method: "DELETE",
    path: "{prefix}/admin/categories/{id}",
    auth: "JWT / admin:api",
    desc: "删除类别（无兑换记录时）",
  },
  {
    method: "GET",
    path: "{prefix}/admin/cards",
    auth: "管理员",
    desc: "卡密分页列表",
    query: "page, page_size, status?, q?, category?, batch_id?",
  },
  {
    method: "GET",
    path: "{prefix}/admin/cards/{id}",
    auth: "管理员",
    desc: "卡密详情；reveal=1 返回 content（二进制为 base64）及 filename/mime/size",
    query: "reveal=0|1",
  },
  {
    method: "POST",
    path: "{prefix}/admin/cards",
    auth: "JWT / admin:api",
    desc: "创建卡密：JSON（文本 utf8 或文件 base64）或 multipart（字段 file）",
    body: 'JSON: { categoryId, content, type?, contentEncoding?: "utf8"|"base64", filename?, mime?, note?, batchId? } · type=text|txt|json|account|image|zip|pdf|file · multipart: categoryId + file + type? + note?',
  },
  {
    method: "POST",
    path: "{prefix}/admin/cards/import",
    auth: "JWT / admin:api",
    desc: "批量导入（仅 text/txt/json/account；每行一条内容）",
    body: '{ "categoryId", "raw", "type?", "batchName?", "note?" }',
  },
  {
    method: "POST",
    path: "{prefix}/admin/cards/batch-action",
    auth: "管理员",
    desc: "批量 enable / disable / delete",
    body: '{ "ids": [], "action": "enable|disable|delete" }',
  },
  {
    method: "GET",
    path: "{prefix}/admin/cards/export",
    auth: "JWT / admin:api",
    desc: "按筛选导出卡密编码（data.codes 一行一个下载）",
    query: "status?, q?, category?, batch_id?, ids?",
  },
  {
    method: "POST",
    path: "{prefix}/admin/cards/export",
    auth: "JWT / admin:api",
    desc: "导出卡密编码；format=txt 或 Accept:text/plain 时流式纯文本（X-Export-Total）；JSON 返回 codes[]",
    body: '{ "ids"?: [], "status"?, "q"?, "category"?, "batchId"?, "format"?: "txt" }',
  },
  {
    method: "GET",
    path: "{prefix}/admin/batches",
    auth: "管理员",
    desc: "批次列表",
    query: "category?",
  },
  {
    method: "GET",
    path: "{prefix}/admin/batches/{id}/export",
    auth: "JWT / admin:api",
    desc: "按批次导出全部卡密编码（data.codes 一行一个）",
  },
  {
    method: "DELETE",
    path: "{prefix}/admin/batches/{id}",
    auth: "管理员",
    desc: "删除批次（无已兑/过期卡密时）",
  },
  {
    method: "GET",
    path: "{prefix}/admin/redeems",
    auth: "管理员",
    desc: "兑换记录分页",
    query: "page, page_size, q?, category?",
  },
  {
    method: "GET",
    path: "{prefix}/admin/api-keys",
    auth: "管理员",
    desc: "API 密钥列表",
  },
  {
    method: "POST",
    path: "{prefix}/admin/api-keys",
    auth: "管理员",
    desc: "创建 API 密钥",
    body: '{ "name", "scopes": ["redeem:api"], "rateLimitRpm?" }',
  },
  {
    method: "POST",
    path: "{prefix}/admin/api-keys/{id}/revoke",
    auth: "管理员",
    desc: "吊销密钥",
  },
  {
    method: "DELETE",
    path: "{prefix}/admin/api-keys/{id}",
    auth: "管理员",
    desc: "永久删除密钥",
  },
  {
    method: "POST",
    path: "{prefix}/admin/api-keys/{id}/rotate",
    auth: "管理员",
    desc: "轮换密钥",
  },
  {
    method: "POST",
    path: "{prefix}/admin/settings/public-redeem-key",
    auth: "管理员",
    desc: "轮换/自定义固定兑换密钥",
    body: '{ "mode": "rotate|custom", "customKey?" }',
  },
  {
    method: "GET",
    path: "{prefix}/admin/settings",
    auth: "管理员",
    desc: "读取系统设置",
  },
  {
    method: "PUT",
    path: "{prefix}/admin/settings",
    auth: "管理员",
    desc: "更新系统设置（含 SMTP / 邮件预警开关）",
  },
  {
    method: "POST",
    path: "{prefix}/admin/settings/mail/test",
    auth: "管理员",
    desc: "测试 SMTP（to 空=连通；有 to=发测试信）",
    body: '{ "to"?: "a@b.com" }',
  },
  {
    method: "POST",
    path: "{prefix}/admin/uploads",
    auth: "管理员",
    desc: "上传图片（multipart field: file）→ { url }",
  },
  {
    method: "GET",
    path: "{prefix}/admin/audit-logs",
    auth: "管理员",
    desc: "审计日志分页",
    query: "page, page_size",
  },
  {
    method: "POST",
    path: "{prefix}/admin/ops/reconcile-stock",
    auth: "管理员",
    desc: "运维：标记过期卡密 + 全量对账类别 unused_count（补偿物化库存漂移）",
  },
  {
    method: "GET",
    path: "{prefix}/admin/updates/check",
    auth: "管理员",
    desc: "检查更新",
  },
  {
    method: "GET",
    path: "{prefix}/admin/updates/history",
    auth: "管理员",
    desc: "版本历史：本机归档 + GitHub Release（可回滚目标）",
  },
  {
    method: "GET",
    path: "{prefix}/admin/updates/status",
    auth: "管理员",
    desc: "更新任务状态",
  },
  {
    method: "POST",
    path: "{prefix}/admin/updates/apply",
    auth: "管理员",
    desc: "应用更新（binary/docker：下载 Linux 资产并重启）",
    body: '{ "version?" }',
  },
  {
    method: "POST",
    path: "{prefix}/admin/updates/rollback",
    auth: "管理员",
    desc: "回滚：previous=.bak；指定版本优先本机归档，否则从 GitHub 下载",
    body: '{ "version?": "previous|0.1.x" }',
  },
];

export function expandPath(path: string, prefix: string) {
  return path.replace(/\{prefix\}/g, prefix);
}
