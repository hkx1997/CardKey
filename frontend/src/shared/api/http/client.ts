import type {
  AdminUser,
  ApiKeyMeta,
  AuditLog,
  Batch,
  Card,
  CardStatus,
  CardType,
  Category,
  DashboardStats,
  PageResult,
  PublicConfig,
  PublicStock,
  RedeemRecord,
  RedeemResult,
  Settings,
} from "@/entities/types";
import { ApiError, type ApiEnvelope } from "@/entities/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    // 管理端列表在 mutation 后必须拿到最新数据，禁止浏览器 HTTP 缓存
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !body?.success) {
    throw new ApiError(
      res.status,
      body?.error?.code ?? "INTERNAL_ERROR",
      body?.error?.message ?? (res.statusText || "请求失败"),
    );
  }
  return body.data as T;
}

/** 真实 HTTP 适配器：契约与 mock 一致 */
export const httpClient = {
  getPublicConfig: () => request<PublicConfig>("/api/v1/public/config"),

  /** 库存轮询：支持 ETag/304，未变时返回缓存 */
  getPublicCategoryStock: (() => {
    let etag: string | null = null;
    let cached: PublicStock | null = null;
    return async (): Promise<PublicStock> => {
      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (etag) headers["If-None-Match"] = etag;
      const res = await fetch("/api/v1/public/category-stock", {
        credentials: "include",
        cache: "no-store",
        headers,
      });
      if (res.status === 304 && cached) {
        return cached;
      }
      const body = (await res.json().catch(() => null)) as ApiEnvelope<PublicStock> | null;
      if (!res.ok || !body?.success) {
        throw new ApiError(
          res.status,
          body?.error?.code ?? "INTERNAL_ERROR",
          body?.error?.message ?? (res.statusText || "请求失败"),
        );
      }
      const nextEtag = res.headers.get("ETag");
      if (nextEtag) etag = nextEtag;
      cached = body.data as PublicStock;
      return cached;
    };
  })(),

  setupStatus: () =>
    request<{
      needsSetup: boolean;
      ready: boolean;
      siteName?: string;
      message?: string;
    }>("/api/v1/public/setup-status"),

  completeSetup: (input: {
    username: string;
    password: string;
    confirmPassword?: string;
    siteName?: string;
    publicRedeemApiKey?: string;
    seedDemoCategories?: boolean;
  }) =>
    request<AdminUser>("/api/v1/public/setup", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  redeem: (input: {
    category: string;
    code: string;
    captchaToken?: string;
    /** 幂等键：相同 key 重试不重复消耗库存 */
    idempotencyKey?: string;
  }) =>
    request<RedeemResult>("/api/v1/public/redeem", {
      method: "POST",
      headers: input.idempotencyKey
        ? { "Idempotency-Key": input.idempotencyKey }
        : undefined,
      body: JSON.stringify({
        category: input.category,
        code: input.code,
        captchaToken: input.captchaToken,
        idempotencyKey: input.idempotencyKey,
      }),
    }),

  login: (username: string, password: string) =>
    request<AdminUser | { requiresTotp: boolean; ticket: string; user?: AdminUser }>(
      "/api/v1/admin/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ username, password }),
      },
    ),

  loginTotp: (ticket: string, code: string) =>
    request<AdminUser>("/api/v1/admin/auth/login/totp", {
      method: "POST",
      body: JSON.stringify({ ticket, code }),
    }),

  beginTotpSetup: () =>
    request<{ secret: string; otpauthUri: string }>(
      "/api/v1/admin/auth/totp/begin",
      { method: "POST", body: "{}" },
    ),

  confirmTotpSetup: (code: string) =>
    request<{ totpEnabled: boolean }>("/api/v1/admin/auth/totp/confirm", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  disableTotp: (code: string) =>
    request<{ totpEnabled: boolean }>("/api/v1/admin/auth/totp/disable", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  importCardsAsync: (input: {
    categoryId: string;
    content: string;
    type?: string;
    batchName?: string;
    note?: string;
  }) =>
    request<{
      id: string;
      status: string;
      totalLines: number;
      doneLines: number;
      successCount: number;
      errorCount: number;
    }>("/api/v1/admin/cards/import-async", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  getImportJob: (id: string) =>
    request<{
      id: string;
      status: string;
      totalLines: number;
      doneLines: number;
      successCount: number;
      errorCount: number;
      errorReport?: string;
    }>(`/api/v1/admin/import-jobs/${id}`),

  logout: () =>
    request<void>("/api/v1/admin/auth/logout", { method: "POST" }),

  me: () => request<AdminUser | null>("/api/v1/admin/auth/me"),

  changePassword: (oldPassword: string, newPassword: string) =>
    request<void>("/api/v1/admin/auth/change-password", {
      method: "POST",
      body: JSON.stringify({
        old_password: oldPassword,
        new_password: newPassword,
      }),
    }),

  dashboardStats: (categorySlug?: string) => {
    const sp = new URLSearchParams();
    if (categorySlug) sp.set("category", categorySlug);
    const q = sp.toString();
    return request<DashboardStats>(
      `/api/v1/admin/dashboard/stats${q ? `?${q}` : ""}`,
    );
  },

  runtimeMetrics: () =>
    request<{
      inFlight: number;
      requestsTotal: number;
      requests1m: number;
      errors4xx: number;
      errors5xx: number;
      errorRatePct: number;
      latencyP50Ms: number;
      latencyP95Ms: number;
      latencyP99Ms: number;
      redeemsTotal: number;
      redeemErrors: number;
      loginsTotal: number;
      dbPoolAcquired: number;
      dbPoolIdle: number;
      dbPoolTotal: number;
      dbPoolMax: number;
      redisOk: boolean;
      uptimeSec: number;
      goRoutines: number;
      memAllocMB: number;
      version: string;
      updateMode: string;
      checkedAt: string;
    }>("/api/v1/admin/dashboard/runtime"),

  listCategories: (opts?: { light?: boolean }) => {
    const q = opts?.light ? "?light=1" : "";
    return request<Category[]>(`/api/v1/admin/categories${q}`);
  },

  createCategory: (input: {
    name: string;
    slug: string;
    codePrefix: string;
    description?: string;
    icon?: Category["icon"];
  }) =>
    request<Category>("/api/v1/admin/categories", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateCategory: (
    id: string,
    patch: Partial<
      Pick<Category, "name" | "description" | "enabled" | "sortOrder" | "icon">
    >,
  ) =>
    request<Category>(`/api/v1/admin/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteCategory: (id: string) =>
    request<void>(`/api/v1/admin/categories/${id}`, { method: "DELETE" }),

  listCards: (params: {
    page?: number;
    pageSize?: number;
    status?: CardStatus | "all";
    q?: string;
    batchId?: string;
    categorySlug?: string;
    cursor?: string;
  }) => {
    const sp = new URLSearchParams();
    if (params.page) sp.set("page", String(params.page));
    if (params.pageSize) sp.set("page_size", String(params.pageSize));
    if (params.status && params.status !== "all") sp.set("status", params.status);
    if (params.q) sp.set("q", params.q);
    if (params.batchId) sp.set("batch_id", params.batchId);
    if (params.categorySlug) sp.set("category", params.categorySlug);
    if (params.cursor) sp.set("cursor", params.cursor);
    return request<PageResult<Card>>(`/api/v1/admin/cards?${sp}`);
  },

  getCard: (id: string, reveal = false) =>
    request<Card>(`/api/v1/admin/cards/${id}?reveal=${reveal ? 1 : 0}`),

  createCard: (input: {
    content: string;
    type: CardType;
    note?: string;
    batchId?: string | null;
    categoryId: string;
    contentEncoding?: "utf8" | "base64" | string;
    filename?: string;
    mime?: string;
  }) =>
    request<Card>("/api/v1/admin/cards", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  importCards: (input: {
    raw: string;
    type: CardType;
    categoryId: string;
    batchName?: string;
    note?: string;
  }) =>
    request<{
      batch: Batch | null;
      codes: string[];
      total: number;
      category: Category;
    }>("/api/v1/admin/cards/import", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  batchAction: (ids: string[], action: "disable" | "enable" | "delete") =>
    request<number>("/api/v1/admin/cards/batch-action", {
      method: "POST",
      body: JSON.stringify({ ids, action }),
    }),

  /** 导出卡密编码（一行一个）；默认流式 txt，省内存并支持进度 */
  exportCards: async (
    params: {
      ids?: string[];
      status?: CardStatus | "all";
      q?: string;
      batchId?: string;
      categorySlug?: string;
    },
    opts?: { onProgress?: (done: number, total: number) => void },
  ): Promise<{ codes: string[]; total: number }> => {
    const res = await fetch("/api/v1/admin/cards/export", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/plain",
      },
      body: JSON.stringify({
        ids: params.ids,
        status: params.status && params.status !== "all" ? params.status : undefined,
        q: params.q || undefined,
        category: params.categorySlug || undefined,
        batchId: params.batchId || undefined,
        format: "txt",
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiEnvelope<unknown> | null;
      throw new ApiError(
        res.status,
        body?.error?.code ?? "INTERNAL_ERROR",
        body?.error?.message ?? (res.statusText || "导出失败"),
      );
    }
    const totalHeader = Number(res.headers.get("X-Export-Total") || 0);
    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      const codes = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
      return { codes, total: codes.length };
    }
    const decoder = new TextDecoder();
    let buf = "";
    const codes: string[] = [];
    let doneCount = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split(/\r?\n/);
      buf = parts.pop() ?? "";
      for (const line of parts) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        codes.push(t);
        doneCount++;
        opts?.onProgress?.(doneCount, totalHeader || doneCount);
      }
    }
    const last = buf.trim();
    if (last && !last.startsWith("#")) {
      codes.push(last);
      doneCount++;
      opts?.onProgress?.(doneCount, totalHeader || doneCount);
    }
    return { codes, total: codes.length };
  },

  listBatches: (categorySlug?: string) => {
    const sp = new URLSearchParams();
    if (categorySlug) sp.set("category", categorySlug);
    const q = sp.toString();
    return request<Batch[]>(`/api/v1/admin/batches${q ? `?${q}` : ""}`);
  },

  exportBatch: (id: string) =>
    request<{
      codes: string[];
      total: number;
      batchId: string;
      batchName: string;
    }>(`/api/v1/admin/batches/${id}/export`),

  deleteBatch: (id: string) =>
    request<void>(`/api/v1/admin/batches/${id}`, { method: "DELETE" }),

  listRedeems: (params: {
    page?: number;
    pageSize?: number;
    q?: string;
    categorySlug?: string;
    cursor?: string;
  }) => {
    const sp = new URLSearchParams();
    if (params.page) sp.set("page", String(params.page));
    if (params.pageSize) sp.set("page_size", String(params.pageSize));
    if (params.q) sp.set("q", params.q);
    if (params.categorySlug) sp.set("category", params.categorySlug);
    if (params.cursor) sp.set("cursor", params.cursor);
    return request<PageResult<RedeemRecord>>(`/api/v1/admin/redeems?${sp}`);
  },

  listApiKeys: () => request<ApiKeyMeta[]>("/api/v1/admin/api-keys"),

  createApiKey: (input: {
    name: string;
    scopes: Array<"redeem:api" | "admin:api" | "system:update">;
    rateLimitRpm?: number | null;
  }) =>
    request<{ key: ApiKeyMeta; plaintext: string }>("/api/v1/admin/api-keys", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  revokeApiKey: (id: string) =>
    request<void>(`/api/v1/admin/api-keys/${id}/revoke`, { method: "POST" }),

  deleteApiKey: (id: string) =>
    request<void>(`/api/v1/admin/api-keys/${id}`, { method: "DELETE" }),

  rotateApiKey: (id: string) =>
    request<{ key: ApiKeyMeta; plaintext: string }>(
      `/api/v1/admin/api-keys/${id}/rotate`,
      { method: "POST" },
    ),

  setPublicRedeemApiKey: (input: {
    mode: "rotate" | "custom";
    customKey?: string;
  }) =>
    request<{ plaintext: string }>(
      "/api/v1/admin/settings/public-redeem-key",
      { method: "POST", body: JSON.stringify(input) },
    ),

  getSettings: () => request<Settings>("/api/v1/admin/settings"),

  updateSettings: (patch: Partial<Settings>) =>
    request<Settings>("/api/v1/admin/settings", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  testMail: (to?: string) =>
    request<{ message: string }>("/api/v1/admin/settings/mail/test", {
      method: "POST",
      body: JSON.stringify({ to: to || "" }),
    }),

  uploadImage: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/v1/admin/uploads", {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    const body = (await res.json().catch(() => null)) as {
      success?: boolean;
      data?: { url: string };
      error?: { code: string; message: string };
    } | null;
    if (!res.ok || !body?.success || !body.data?.url) {
      const { ApiError } = await import("@/entities/types");
      throw new ApiError(
        res.status,
        body?.error?.code ?? "INTERNAL_ERROR",
        body?.error?.message ?? "上传失败",
      );
    }
    return body.data;
  },

  listAuditLogs: (params: {
    page?: number;
    pageSize?: number;
    cursor?: string;
  }) => {
    const sp = new URLSearchParams();
    if (params.page) sp.set("page", String(params.page));
    if (params.pageSize) sp.set("page_size", String(params.pageSize));
    if (params.cursor) sp.set("cursor", params.cursor);
    return request<PageResult<AuditLog>>(`/api/v1/admin/audit-logs?${sp}`);
  },

  systemInfo: () =>
    request<{
      version: string;
      commit: string;
      buildTime: string;
      goVersion: string;
      goos: string;
      goarch: string;
      updateMode: string;
      startedAt: string;
      uptimeSec: number;
      migrationsEmbedded?: boolean;
      migrationsBundled?: string[];
      migrationsApplied?: string[];
      staticEmbedded?: boolean;
      staticEmbeddedFiles?: number;
      binaryPath?: string;
      binarySize?: number;
      csrfCheck?: boolean;
      env?: string;
      warnings?: { code: string; message: string }[];
    }>("/api/v1/admin/system/info"),

  checkUpdates: (force?: boolean) =>
    request<{
      current: string;
      latest?: string;
      hasUpdate: boolean;
      releaseUrl?: string;
      body?: string;
      publishedAt?: string;
      mode: string;
      message?: string;
      fromCache?: boolean;
      authenticated?: boolean;
      tokenRecommended?: boolean;
    }>(
      `/api/v1/admin/updates/check${force ? "?force=1" : ""}`,
    ),

  updateHistory: () =>
    request<
      Array<{
        version: string;
        path?: string;
        modTime?: string;
        isCurrent: boolean;
        /** local | remote | both */
        source?: string;
        canInstall?: boolean;
      }>
    >("/api/v1/admin/updates/history"),

  updateStatus: () =>
    request<{
      state: string;
      message?: string;
      progress: number;
      error?: string;
    }>("/api/v1/admin/updates/status"),

  applyUpdate: (version?: string) =>
    request<{ status: string }>("/api/v1/admin/updates/apply", {
      method: "POST",
      body: JSON.stringify({ version: version ?? "" }),
    }),

  rollbackUpdate: (version?: string) =>
    request<{ status: string }>("/api/v1/admin/updates/rollback", {
      method: "POST",
      body: JSON.stringify({ version: version ?? "previous" }),
    }),
};
