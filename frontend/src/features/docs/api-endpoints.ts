/** API 接口清单 — 与 backend/internal/server/server.go 保持同步 */

export type ApiEndpoint = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  auth: string;
  desc: string;
  body?: string;
  query?: string;
};

/** 公开 / 无需登录（部分需 API Key） */
export const PUBLIC_ENDPOINTS: ApiEndpoint[] = [
  {
    method: "GET",
    path: "/healthz",
    auth: "无",
    desc: "存活检查",
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
    auth: "无",
    desc: "Prometheus 文本指标",
  },
  {
    method: "GET",
    path: "{prefix}/public/config",
    auth: "无",
    desc: "公开站点配置、类别列表、限流等",
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
  {
    method: "POST",
    path: "{prefix}/public/redeem",
    auth: "Bearer（若开启强制 Key）",
    desc: "兑换卡密（返回 content；二进制另含 contentEncoding=base64、filename、mime、size，前端可下载）",
    body: '{ "category": "slug", "code": "XXX-..." }',
  },
  {
    method: "GET",
    path: "/uploads/*",
    auth: "无",
    desc: "已上传的图片静态资源",
  },
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
    desc: "卡密详情",
    query: "reveal=0|1",
  },
  {
    method: "POST",
    path: "{prefix}/admin/cards",
    auth: "管理员",
    desc: "创建卡密（JSON 或 multipart 文件）",
    body: '{ "categoryId", "content", "type?", "contentEncoding?", "filename?", "mime?", "note?" } · type: text|txt|json|account|image|zip|pdf|file · 二进制 contentEncoding=base64 · multipart: file+categoryId',
  },
  {
    method: "POST",
    path: "{prefix}/admin/cards/import",
    auth: "管理员",
    desc: "批量导入（仅文本类 text/txt/json/account）",
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
    path: "{prefix}/admin/batches",
    auth: "管理员",
    desc: "批次列表",
    query: "category?",
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
    method: "GET",
    path: "{prefix}/admin/updates/check",
    auth: "管理员",
    desc: "检查更新",
  },
  {
    method: "GET",
    path: "{prefix}/admin/updates/history",
    auth: "管理员",
    desc: "本地可回滚版本",
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
    desc: "应用更新（binary 模式）",
    body: '{ "version?" }',
  },
  {
    method: "POST",
    path: "{prefix}/admin/updates/rollback",
    auth: "管理员",
    desc: "回滚版本",
    body: '{ "version?" }',
  },
];

export function expandPath(path: string, prefix: string) {
  return path.replace(/\{prefix\}/g, prefix);
}
