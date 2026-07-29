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
import { ApiError } from "@/entities/types";
import { delay, mockStore, pushAudit } from "./store";

function err(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}

function asApiError(e: unknown): never {
  if (e && typeof e === "object" && "code" in e && "status" in e) {
    const x = e as { status: number; code: string; message: string };
    err(x.status, x.code, x.message || "错误");
  }
  throw e;
}

export const mockClient = {
  async setupStatus() {
    await delay(80);
    const db = mockStore.getDb();
    const needsSetup = !db.session && db.admin.password === "" && false;
    // mock 始终有默认 admin，视为已安装
    return {
      needsSetup: false as boolean,
      ready: true,
      siteName: db.settings.siteName,
      message: "Mock 已就绪",
      // expose for tests that reset admin
      _unused: needsSetup,
    };
  },

  async completeSetup(_input: {
    username: string;
    password: string;
    confirmPassword?: string;
    siteName?: string;
    publicRedeemApiKey?: string;
  }): Promise<AdminUser> {
    await delay();
    err(409, "CONFLICT", "Mock 模式已初始化，请使用 admin / admin123 登录");
  },

  async getPublicConfig(): Promise<PublicConfig> {
    await delay();
    const db = mockStore.getDb();
    const s = db.settings;
    const docsOn = !!s.apiDocsEnabled;
    return {
      siteName: s.siteName,
      siteLogo: s.siteLogo || null,
      siteFavicon: s.siteFavicon || null,
      footerText: s.footerText || "",
      documentTitle: s.documentTitle || s.siteName || "CardKey",
      redeemTitle: s.redeemTitle,
      redeemSubtitle: s.redeemSubtitle,
      redeemSuccessHint: s.redeemSuccessHint || "兑换成功",
      redeemPlaceholder: s.redeemPlaceholder,
      redeemButtonText: s.redeemButtonText || "立即兑换",
      captchaEnabled: s.captchaEnabled,
      redeemTabVisibleCount: Math.max(1, s.redeemTabVisibleCount || 4),
      apiBasePath: s.apiBasePath || "/api/v1",
      apiPublicBaseUrl: s.apiPublicBaseUrl || "",
      apiDocsEnabled: docsOn,
      showApiDocsEntry: docsOn && !!s.showApiDocsEntry,
      // 仅当开放文档 + 显式允许展示时才下发密钥
      publicRedeemApiKey:
        docsOn && s.exposePublicRedeemKeyInDocs && s.publicRedeemApiKey
          ? s.publicRedeemApiKey
          : null,
      rateLimitIpPerMin: s.rateLimitIpPerMin,
      rateLimitCodePerMin: s.rateLimitCodePerMin,
      categories: db.categories
        .filter((c) => c.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({
          slug: c.slug,
          name: c.name,
          codePrefix: c.codePrefix,
          description: c.description,
          icon: c.icon,
          unusedCount: mockStore.availableStock(c.id),
        })),
    };
  },

  async getPublicCategoryStock(): Promise<PublicStock> {
    await delay(60);
    const db = mockStore.getDb();
    return {
      categories: db.categories
        .filter((c) => c.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({
          slug: c.slug,
          unusedCount: mockStore.availableStock(c.id),
        })),
      updatedAt: new Date().toISOString(),
    };
  },

  async redeem(input: {
    category: string;
    code: string;
    captchaToken?: string;
  }): Promise<RedeemResult> {
    await delay(280);
    const db = mockStore.getDb();
    const s = db.settings;
    const ip = "127.0.0.1";
    const normalizedEarly = mockStore.normalizeCode(input.code || "");

    // 公开兑换限流：IP + 编码维度
    if (
      !mockStore.checkRateLimit(`redeem:ip:${ip}`, s.rateLimitIpPerMin)
    ) {
      err(429, "RATE_LIMITED", "请求过于频繁，请稍后再试");
    }
    if (
      normalizedEarly &&
      !mockStore.checkRateLimit(
        `redeem:code:${normalizedEarly}`,
        s.rateLimitCodePerMin,
      )
    ) {
      err(429, "RATE_LIMITED", "请求过于频繁，请稍后再试");
    }

    const cat = mockStore.findCategoryBySlug(input.category);
    if (!cat || !cat.enabled) {
      err(400, "CATEGORY_INVALID", "类别无效或已关闭");
    }
    const normalized = mockStore.normalizeCode(input.code);
    if (!normalized) {
      err(400, "VALIDATION_ERROR", "请输入兑换编码");
    }
    const card = db.cards.find(
      (c) =>
        c.categoryId === cat.id &&
        mockStore.normalizeCode(c.code) === normalized,
    );
    if (!card) {
      err(
        404,
        "CARD_INVALID",
        s.maskCardErrors ? "卡密无效或不可用" : "卡密不存在",
      );
    }
    if (card.status === "disabled") {
      err(403, "CARD_INVALID", "卡密无效或不可用");
    }
    if (card.status === "expired") {
      err(410, "CARD_EXPIRED", "该卡密已过期");
    }
    if (card.status === "used") {
      if (!db.settings.allowRequery) {
        err(409, "CARD_USED", "该卡密已兑换");
      }
      return {
        status: "already_redeemed",
        category: cat.slug,
        categoryName: cat.name,
        code: card.code,
        type: card.type,
        content: card.content ?? "",
        contentEncoding: card.contentEncoding,
        filename: card.filename,
        mime: card.mime,
        size: card.size,
        redeemedAt: card.usedAt ?? new Date().toISOString(),
      };
    }

    card.status = "used";
    card.usedAt = new Date().toISOString();
    card.usedIp = "127.0.0.1";
    db.redeems.unshift({
      id: mockStore.randId(),
      categoryId: cat.id,
      categorySlug: cat.slug,
      categoryName: cat.name,
      cardId: card.id,
      code: card.code,
      ip: "127.0.0.1",
      userAgent: navigator.userAgent,
      createdAt: card.usedAt,
    });
    mockStore.recomputeCounts(db);

    return {
      status: "success",
      category: cat.slug,
      categoryName: cat.name,
      code: card.code,
      type: card.type,
      content: card.content ?? "",
      contentEncoding: card.contentEncoding,
      filename: card.filename,
      mime: card.mime,
      size: card.size,
      redeemedAt: card.usedAt,
    };
  },

  async login(username: string, password: string): Promise<AdminUser> {
    await delay();
    const db = mockStore.getDb();
    if (username !== db.admin.username || password !== db.admin.password) {
      err(401, "UNAUTHORIZED", "账号或密码错误");
    }
    db.session = {
      id: db.admin.id,
      username: db.admin.username,
      mustChangePassword: db.admin.mustChangePassword,
      totpEnabled: false,
    };
    pushAudit({
      actorType: "admin",
      actorLabel: username,
      action: "login",
      resource: "auth",
      detail: "登录成功",
      ip: "127.0.0.1",
    });
    return db.session;
  },

  async loginTotp(_ticket: string, _code: string): Promise<AdminUser> {
    await delay();
    return this.login("admin", "admin123");
  },

  async beginTotpSetup() {
    await delay();
    mockStore.requireSession();
    return {
      secret: "JBSWY3DPEHPK3PXP",
      otpauthUri: "otpauth://totp/CardKey:admin?secret=JBSWY3DPEHPK3PXP&issuer=CardKey",
    };
  },

  async confirmTotpSetup(_code: string) {
    await delay();
    mockStore.requireSession();
    return { totpEnabled: true };
  },

  async disableTotp(_code: string) {
    await delay();
    mockStore.requireSession();
    return { totpEnabled: false };
  },

  async importCardsAsync(input: {
    categoryId: string;
    content: string;
    type?: string;
    batchName?: string;
    note?: string;
  }) {
    await delay();
    mockStore.requireSession();
    const lines = input.content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    // mock: 同步完成
    await this.importCards({
      categoryId: input.categoryId,
      raw: input.content,
      type: (input.type as CardType) || "text",
      batchName: input.batchName,
      note: input.note,
    });
    return {
      id: "job-mock",
      status: "success",
      totalLines: lines.length,
      doneLines: lines.length,
      successCount: lines.length,
      errorCount: 0,
    };
  },

  async getImportJob(id: string) {
    await delay(50);
    return {
      id,
      status: "success" as const,
      totalLines: 1,
      doneLines: 1,
      successCount: 1,
      errorCount: 0,
      errorReport: "" as string | undefined,
    };
  },

  async logout(): Promise<void> {
    await delay(120);
    mockStore.getDb().session = null;
  },

  async me(): Promise<AdminUser | null> {
    await delay(80);
    return mockStore.getDb().session;
  },

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await delay();
    mockStore.requireSession();
    const db = mockStore.getDb();
    if (oldPassword !== db.admin.password) {
      err(400, "VALIDATION_ERROR", "原密码不正确");
    }
    db.admin.password = newPassword;
    db.admin.mustChangePassword = false;
    if (db.session) db.session.mustChangePassword = false;
  },

  async dashboardStats(categorySlug?: string): Promise<DashboardStats> {
    await delay();
    mockStore.requireSession();
    const db = mockStore.getDb();
    mockStore.recomputeCounts(db);
    let cards = db.cards;
    let redeems = db.redeems;
    if (categorySlug) {
      const cat = mockStore.findCategoryBySlug(categorySlug);
      if (cat) {
        cards = cards.filter((c) => c.categoryId === cat.id);
        redeems = redeems.filter((r) => r.categoryId === cat.id);
      }
    }
    const dayKey = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      return d.toISOString().slice(0, 10);
    };
    const today = dayKey(0);
    const yesterday = dayKey(1);
    const todayRedeems = redeems.filter((r) =>
      r.createdAt.startsWith(today),
    ).length;
    const yesterdayRedeems = redeems.filter((r) =>
      r.createdAt.startsWith(yesterday),
    ).length;
    const weekRedeems = redeems.filter((r) => {
      const t = new Date(r.createdAt).getTime();
      return t >= Date.now() - 7 * 86400000;
    }).length;
    const unused = cards.filter((c) => c.status === "unused").length;
    const used = cards.filter((c) => c.status === "used").length;
    const disabled = cards.filter((c) => c.status === "disabled").length;
    const expired = cards.filter((c) => c.status === "expired").length;
    const total = cards.length;
    const trend = Array.from({ length: 14 }, (_, i) => {
      const key = dayKey(13 - i);
      return {
        date: key,
        label: key.slice(5),
        count: redeems.filter((r) => r.createdAt.startsWith(key)).length,
      };
    });
    const byCategory = db.categories
      .filter((c) => c.enabled || (c.cardCount ?? 0) > 0)
      .map((c) => {
        const t = c.cardCount ?? 0;
        const u = c.usedCount ?? 0;
        return {
          slug: c.slug,
          name: c.name,
          icon: c.icon,
          unused: c.unusedCount ?? 0,
          used: u,
          total: t,
          redeemRate: t ? Math.round((u / t) * 100) : 0,
        };
      });
    return {
      totalCards: total,
      unusedCards: unused,
      usedCards: used,
      disabledCards: disabled,
      expiredCards: expired,
      todayRedeems,
      yesterdayRedeems,
      weekRedeems,
      totalRedeems: redeems.length,
      redeemRate: total ? Math.round((used / total) * 100) : 0,
      totalCategories: db.categories.length,
      enabledCategories: db.categories.filter((c) => c.enabled).length,
      activeApiKeys: db.apiKeys.filter((k) => !k.revokedAt).length,
      trend,
      byCategory,
      recentRedeems: redeems.slice(0, 8),
      statusBreakdown: [
        { status: "unused", count: unused },
        { status: "used", count: used },
        { status: "disabled", count: disabled },
        { status: "expired", count: expired },
      ],
    };
  },

  async listCategories(_opts?: { light?: boolean }): Promise<Category[]> {
    await delay();
    mockStore.requireSession();
    mockStore.recomputeCounts(mockStore.getDb());
    return [...mockStore.getDb().categories].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
  },

  async createCategory(input: {
    name: string;
    slug: string;
    codePrefix: string;
    description?: string;
    icon?: Category["icon"];
  }): Promise<Category> {
    await delay();
    const session = mockStore.requireSession();
    const db = mockStore.getDb();
    const slug = input.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    const prefix = input.codePrefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!slug || !prefix || !input.name.trim()) {
      err(400, "VALIDATION_ERROR", "名称、标识、编码前缀均必填");
    }
    if (db.categories.some((c) => c.slug === slug)) {
      err(409, "CONFLICT", "slug 已存在");
    }
    if (db.categories.some((c) => c.codePrefix === prefix)) {
      err(409, "CONFLICT", "编码前缀已被其他类别使用");
    }
    const cat: Category = {
      id: mockStore.randId(),
      name: input.name.trim(),
      slug,
      codePrefix: prefix,
      description: input.description ?? "",
      enabled: true,
      sortOrder: db.categories.length + 1,
      icon: input.icon ?? { kind: "lucide", value: "ticket" },
      cardCount: 0,
      unusedCount: 0,
      usedCount: 0,
      createdAt: new Date().toISOString(),
    };
    db.categories.push(cat);
    pushAudit({
      actorType: "admin",
      actorLabel: session.username,
      action: "create_category",
      resource: `category:${cat.id}`,
      detail: `${cat.name} (${cat.codePrefix})`,
      ip: "127.0.0.1",
    });
    return cat;
  },

  async updateCategory(
    id: string,
    patch: Partial<
      Pick<Category, "name" | "description" | "enabled" | "sortOrder" | "icon">
    >,
  ): Promise<Category> {
    await delay();
    const session = mockStore.requireSession();
    const cat = mockStore.findCategoryById(id);
    if (!cat) err(404, "NOT_FOUND", "类别不存在");
    Object.assign(cat, patch);
    pushAudit({
      actorType: "admin",
      actorLabel: session.username,
      action: "update_category",
      resource: `category:${id}`,
      detail: cat.name,
      ip: "127.0.0.1",
    });
    return { ...cat };
  },

  async deleteCategory(id: string): Promise<void> {
    await delay();
    const session = mockStore.requireSession();
    const db = mockStore.getDb();
    const cat = mockStore.findCategoryById(id);
    if (!cat) err(404, "NOT_FOUND", "类别不存在");
    const usedCards = db.cards.filter(
      (c) => c.categoryId === id && c.status === "used",
    ).length;
    const redeems = db.redeems.filter((r) => r.categoryId === id).length;
    if (usedCards > 0 || redeems > 0) {
      err(409, "CONFLICT", "该类别已有兑换记录，无法删除，只能停用");
    }
    db.cards = db.cards.filter((c) => c.categoryId !== id);
    db.batches = db.batches.filter((b) => b.categoryId !== id);
    db.categories = db.categories.filter((c) => c.id !== id);
    mockStore.recomputeCounts(db);
    pushAudit({
      actorType: "admin",
      actorLabel: session.username,
      action: "delete_category",
      resource: `category:${id}`,
      detail: cat.name,
      ip: "127.0.0.1",
    });
  },

  async listCards(params: {
    page?: number;
    pageSize?: number;
    status?: CardStatus | "all";
    q?: string;
    batchId?: string;
    categorySlug?: string;
    cursor?: string;
  }): Promise<PageResult<Card>> {
    await delay();
    mockStore.requireSession();
    const res = mockStore.listCards({
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 10,
      status: params.status,
      q: params.q,
      batchId: params.batchId,
      categorySlug: params.categorySlug,
    });
    return {
      ...res,
      totalExact: true,
      hasMore: res.page * res.pageSize < res.total,
      nextCursor: res.page * res.pageSize < res.total ? "mock-next" : "",
    };
  },

  async getCard(id: string, reveal = false): Promise<Card> {
    await delay();
    mockStore.requireSession();
    const card = mockStore.getDb().cards.find((c) => c.id === id);
    if (!card) err(404, "NOT_FOUND", "卡密不存在");
    if (reveal) {
      pushAudit({
        actorType: "admin",
        actorLabel: mockStore.getDb().session!.username,
        action: "reveal_content",
        resource: `card:${card.id}`,
        detail: "查看卡密内容",
        ip: "127.0.0.1",
      });
      return { ...card };
    }
    return { ...card, content: undefined };
  },

  async createCard(input: {
    content: string;
    type: CardType;
    note?: string;
    batchId?: string | null;
    categoryId: string;
    contentEncoding?: string;
    filename?: string;
    mime?: string;
  }): Promise<Card> {
    await delay();
    const session = mockStore.requireSession();
    try {
      const card = mockStore.createCard(input);
      pushAudit({
        actorType: "admin",
        actorLabel: session.username,
        action: "create_card",
        resource: `card:${card.id}`,
        detail: `创建 ${card.code}`,
        ip: "127.0.0.1",
      });
      return card;
    } catch (e) {
      asApiError(e);
    }
  },

  async importCards(input: {
    raw: string;
    type: CardType;
    categoryId: string;
    batchName?: string;
    note?: string;
  }): Promise<{ batch: Batch | null; codes: string[]; total: number; category: Category }> {
    await delay(500);
    const session = mockStore.requireSession();
    try {
      const lines = input.raw.split(/\r?\n/);
      const { batch, cards, category } = mockStore.importCards({
        lines,
        type: input.type,
        categoryId: input.categoryId,
        batchName: input.batchName,
        note: input.note,
      });
      pushAudit({
        actorType: "admin",
        actorLabel: session.username,
        action: "import",
        resource: `category:${category.id}`,
        detail: `导入 ${cards.length} 条 → ${category.name}`,
        ip: "127.0.0.1",
      });
      return {
        batch: batch ?? null,
        codes: cards.map((c) => c.code),
        total: cards.length,
        category,
      };
    } catch (e) {
      asApiError(e);
    }
  },

  async batchAction(
    ids: string[],
    action: "disable" | "enable" | "delete",
  ): Promise<number> {
    await delay();
    const session = mockStore.requireSession();
    const db = mockStore.getDb();
    let n = 0;
    if (action === "delete") {
      const before = db.cards.length;
      db.cards = db.cards.filter((c) => {
        if (!ids.includes(c.id)) return true;
        if (c.status === "unused" || c.status === "disabled") {
          n++;
          return false;
        }
        return true;
      });
      // keep n accurate if filter path used
      if (n === 0 && before !== db.cards.length) {
        n = before - db.cards.length;
      }
    } else if (action === "disable") {
      for (const id of ids) {
        const card = db.cards.find((c) => c.id === id);
        if (!card || card.status !== "unused") continue;
        card.status = "disabled";
        n++;
      }
    } else {
      // enable / restore: disabled + used → unused
      for (const id of ids) {
        const card = db.cards.find((c) => c.id === id);
        if (!card || (card.status !== "disabled" && card.status !== "used")) {
          continue;
        }
        card.status = "unused";
        card.usedAt = null;
        card.usedIp = null;
        n++;
      }
    }
    mockStore.recomputeCounts(db);
    pushAudit({
      actorType: "admin",
      actorLabel: session.username,
      action: `batch_${action}`,
      resource: "cards",
      detail: `${action} ${n} 条`,
      ip: "127.0.0.1",
    });
    return n;
  },

  async exportCards(
    params: {
      ids?: string[];
      status?: CardStatus | "all";
      q?: string;
      batchId?: string;
      categorySlug?: string;
    },
    opts?: { onProgress?: (done: number, total: number) => void },
  ): Promise<{ codes: string[]; total: number }> {
    await delay();
    mockStore.requireSession();
    const db = mockStore.getDb();
    let items = [...db.cards];
    if (params.ids && params.ids.length > 0) {
      const set = new Set(params.ids);
      items = items.filter((c) => set.has(c.id));
    } else {
      if (params.categorySlug) {
        const cat = mockStore.findCategoryBySlug(params.categorySlug);
        if (cat) items = items.filter((c) => c.categoryId === cat.id);
      }
      if (params.status && params.status !== "all") {
        items = items.filter((c) => c.status === params.status);
      }
      if (params.batchId) {
        items = items.filter((c) => c.batchId === params.batchId);
      }
      if (params.q) {
        const q = params.q.toUpperCase();
        items = items.filter(
          (c) =>
            c.code.includes(q) ||
            c.note.toLowerCase().includes(params.q!.toLowerCase()),
        );
      }
    }
    items.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    if (items.length === 0) err(400, "VALIDATION_ERROR", "没有可导出的卡密");
    const codes = items.map((c) => c.code);
    opts?.onProgress?.(codes.length, codes.length);
    return { codes, total: codes.length };
  },

  async listBatches(params?: {
    categorySlug?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PageResult<Batch>> {
    await delay();
    mockStore.requireSession();
    let list = [...mockStore.getDb().batches];
    const categorySlug = params?.categorySlug;
    if (categorySlug) {
      const cat = mockStore.findCategoryBySlug(categorySlug);
      if (cat) list = list.filter((b) => b.categoryId === cat.id);
    }
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 20;
    const total = list.length;
    const start = (page - 1) * pageSize;
    const items = list.slice(start, start + pageSize);
    return {
      items,
      total,
      page,
      pageSize,
      totalExact: true,
      hasMore: start + pageSize < total,
    };
  },

  async exportBatch(
    id: string,
  ): Promise<{
    codes: string[];
    total: number;
    batchId: string;
    batchName: string;
  }> {
    await delay();
    mockStore.requireSession();
    const db = mockStore.getDb();
    const batch = db.batches.find((b) => b.id === id);
    if (!batch) err(404, "NOT_FOUND", "批次不存在");
    const items = db.cards
      .filter((c) => c.batchId === id)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    if (items.length === 0) err(400, "VALIDATION_ERROR", "没有可导出的卡密");
    const codes = items.map((c) => c.code);
    return {
      codes,
      total: codes.length,
      batchId: id,
      batchName: batch.name,
    };
  },

  async deleteBatch(id: string): Promise<void> {
    await delay();
    const session = mockStore.requireSession();
    const db = mockStore.getDb();
    const batch = db.batches.find((b) => b.id === id);
    if (!batch) err(404, "NOT_FOUND", "批次不存在");
    const blocked = db.cards.some(
      (c) =>
        c.batchId === id && (c.status === "used" || c.status === "expired"),
    );
    if (blocked) {
      err(409, "CONFLICT", "批次内存在已兑换/过期卡密，无法删除");
    }
    db.cards = db.cards.filter(
      (c) =>
        !(
          c.batchId === id &&
          (c.status === "unused" || c.status === "disabled")
        ),
    );
    db.batches = db.batches.filter((b) => b.id !== id);
    mockStore.recomputeCounts(db);
    pushAudit({
      actorType: "admin",
      actorLabel: session.username,
      action: "delete_batch",
      resource: `batch:${id}`,
      detail: batch.name,
      ip: "127.0.0.1",
    });
  },

  async listRedeems(params: {
    page?: number;
    pageSize?: number;
    q?: string;
    categorySlug?: string;
    cursor?: string;
  }): Promise<PageResult<RedeemRecord>> {
    await delay();
    mockStore.requireSession();
    let items = [...mockStore.getDb().redeems];
    if (params.categorySlug) {
      const cat = mockStore.findCategoryBySlug(params.categorySlug);
      if (cat) items = items.filter((r) => r.categoryId === cat.id);
    }
    if (params.q) {
      const q = params.q.toUpperCase();
      items = items.filter(
        (r) => r.code.includes(q) || r.ip.includes(params.q!),
      );
    }
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 10;
    const total = items.length;
    const start = (page - 1) * pageSize;
    const slice = items.slice(start, start + pageSize);
    return {
      items: slice,
      total,
      page,
      pageSize,
      totalExact: true,
      hasMore: start + pageSize < total,
      nextCursor: start + pageSize < total ? "mock-next" : "",
    };
  },

  async listApiKeys(): Promise<ApiKeyMeta[]> {
    await delay();
    mockStore.requireSession();
    const db = mockStore.getDb();
    // 系统固定密钥与 settings 同步完整 secret
    const sys = db.apiKeys.find((k) => k.isSystemRedeemKey);
    if (sys) {
      sys.secret = db.settings.publicRedeemApiKey;
      sys.keyPrefix = db.settings.publicRedeemApiKey.slice(0, 14);
    }
    return db.apiKeys.map((k) => ({ ...k }));
  },

  async createApiKey(input: {
    name: string;
    scopes: Array<"redeem:api" | "admin:api" | "system:update">;
    rateLimitRpm?: number | null;
  }): Promise<{ key: ApiKeyMeta; plaintext: string }> {
    await delay();
    const session = mockStore.requireSession();
    if (!input.scopes.length) {
      err(400, "VALIDATION_ERROR", "至少选择一项权限");
    }
    const plaintext = `ck_live_${Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}`;
    const key: ApiKeyMeta = {
      id: mockStore.randId(),
      name: input.name,
      keyPrefix: plaintext.slice(0, 14),
      scopes: input.scopes,
      secret: plaintext,
      rateLimitRpm: input.rateLimitRpm ?? 120,
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
    };
    mockStore.getDb().apiKeys.unshift(key);
    pushAudit({
      actorType: "admin",
      actorLabel: session.username,
      action: "create_api_key",
      resource: `api_key:${key.id}`,
      detail: `${key.name} [${key.scopes.join(",")}]`,
      ip: "127.0.0.1",
    });
    return { key: { ...key }, plaintext };
  },

  async revokeApiKey(id: string): Promise<void> {
    await delay();
    const session = mockStore.requireSession();
    const key = mockStore.getDb().apiKeys.find((k) => k.id === id);
    if (!key) err(404, "NOT_FOUND", "密钥不存在");
    if (key.isSystemRedeemKey) {
      err(400, "VALIDATION_ERROR", "系统固定兑换密钥不可吊销，请使用轮换/自定义");
    }
    if (key.revokedAt) err(400, "VALIDATION_ERROR", "密钥已吊销或不存在");
    key.revokedAt = new Date().toISOString();
    pushAudit({
      actorType: "admin",
      actorLabel: session.username,
      action: "revoke_api_key",
      resource: `api_key:${id}`,
      detail: key.name,
      ip: "127.0.0.1",
    });
  },

  async deleteApiKey(id: string): Promise<void> {
    await delay();
    const session = mockStore.requireSession();
    const db = mockStore.getDb();
    const key = db.apiKeys.find((k) => k.id === id);
    if (!key) err(404, "NOT_FOUND", "密钥不存在");
    if (key.isSystemRedeemKey) {
      err(400, "VALIDATION_ERROR", "系统固定密钥不可删除，请使用轮换");
    }
    db.apiKeys = db.apiKeys.filter((k) => k.id !== id);
    pushAudit({
      actorType: "admin",
      actorLabel: session.username,
      action: "delete_api_key",
      resource: `api_key:${id}`,
      detail: key.name,
      ip: "127.0.0.1",
    });
  },

  /** 轮换普通 API 密钥（生成新 secret，旧值失效） */
  async rotateApiKey(id: string): Promise<{ key: ApiKeyMeta; plaintext: string }> {
    await delay();
    const session = mockStore.requireSession();
    const key = mockStore.getDb().apiKeys.find((k) => k.id === id);
    if (!key) err(404, "NOT_FOUND", "密钥不存在");
    if (key.isSystemRedeemKey) {
      err(400, "VALIDATION_ERROR", "请使用固定兑换密钥的轮换接口");
    }
    if (key.revokedAt) err(400, "VALIDATION_ERROR", "已吊销密钥不可轮换");
    const plaintext = `ck_live_${Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}`;
    key.secret = plaintext;
    key.keyPrefix = plaintext.slice(0, 14);
    key.lastUsedAt = null;
    pushAudit({
      actorType: "admin",
      actorLabel: session.username,
      action: "rotate_api_key",
      resource: `api_key:${id}`,
      detail: key.name,
      ip: "127.0.0.1",
    });
    return { key: { ...key }, plaintext };
  },

  /** 轮换或自定义固定兑换密钥（仅 redeem:api） */
  async setPublicRedeemApiKey(input: {
    mode: "rotate" | "custom";
    customKey?: string;
  }): Promise<{ plaintext: string }> {
    await delay();
    const session = mockStore.requireSession();
    const db = mockStore.getDb();
    let plaintext: string;
    if (input.mode === "custom") {
      const k = (input.customKey ?? "").trim();
      if (k.length < 16) {
        err(400, "VALIDATION_ERROR", "自定义密钥至少 16 位");
      }
      plaintext = k;
    } else {
      plaintext = `ck_redeem_${Array.from(crypto.getRandomValues(new Uint8Array(18)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")}`;
    }
    db.settings.publicRedeemApiKey = plaintext;
    const sys = db.apiKeys.find((k) => k.isSystemRedeemKey);
    if (sys) {
      sys.keyPrefix = plaintext.slice(0, 14);
      sys.secret = plaintext;
      sys.scopes = ["redeem:api"];
      sys.revokedAt = null;
    }
    pushAudit({
      actorType: "admin",
      actorLabel: session.username,
      action: "set_public_redeem_key",
      resource: "settings",
      detail: input.mode === "custom" ? "自定义固定兑换密钥" : "轮换固定兑换密钥",
      ip: "127.0.0.1",
    });
    return { plaintext };
  },

  async getSettings(): Promise<Settings> {
    await delay();
    mockStore.requireSession();
    return { ...mockStore.getDb().settings };
  },

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    await delay();
    const session = mockStore.requireSession();
    const db = mockStore.getDb();
    const next = { ...db.settings, ...patch };
    if (!patch.smtpPassword) {
      next.smtpPassword = db.settings.smtpPassword;
    }
    if (next.smtpPassword) next.smtpPasswordSet = true;
    next.smtpPassword = "";
    db.settings = { ...next, smtpPassword: patch.smtpPassword || db.settings.smtpPassword };
    pushAudit({
      actorType: "admin",
      actorLabel: session.username,
      action: "update_settings",
      resource: "settings",
      detail: "更新系统设置",
      ip: "127.0.0.1",
    });
    return {
      ...db.settings,
      smtpPassword: "",
      smtpPasswordSet: !!db.settings.smtpPassword,
    };
  },

  async testMail(to?: string): Promise<{ message: string }> {
    await delay(200);
    mockStore.requireSession();
    const s = mockStore.getDb().settings;
    if (!s.smtpHost) {
      const { ApiError } = await import("@/entities/types");
      throw new ApiError(400, "VALIDATION", "请先配置 SMTP 主机与发件人邮箱");
    }
    return {
      message: to ? "测试邮件已发送（mock）" : "SMTP 连通正常（mock）",
    };
  },

  async uploadImage(file: File): Promise<{ url: string }> {
    await delay(200);
    mockStore.requireSession();
    // Mock：转 Data URL
    const url = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    return { url };
  },

  async listAuditLogs(params: {
    page?: number;
    pageSize?: number;
    cursor?: string;
  }): Promise<PageResult<AuditLog>> {
    await delay();
    mockStore.requireSession();
    const items = mockStore.getDb().audit;
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const total = items.length;
    const start = (page - 1) * pageSize;
    return {
      items: items.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      totalExact: true,
      hasMore: start + pageSize < total,
      nextCursor: start + pageSize < total ? "mock-next" : "",
    };
  },

  async systemInfo() {
    await delay(50);
    mockStore.requireSession();
    return {
      version: "0.1.0-mock",
      commit: "mock",
      buildTime: new Date().toISOString(),
      goVersion: "mock",
      goos: "browser",
      goarch: "wasm",
      updateMode: "docker",
      startedAt: new Date().toISOString(),
      uptimeSec: 0,
      migrationsEmbedded: true,
      migrationsBundled: ["001_init.sql", "002_icon_value_text.sql", "003_card_content_meta.sql"],
      migrationsApplied: ["001_init.sql", "002_icon_value_text.sql", "003_card_content_meta.sql"],
      staticEmbedded: true,
      staticEmbeddedFiles: 56,
      binarySize: 14_000_000,
      csrfCheck: true,
      env: "development",
      warnings: [],
    };
  },

  async dashboardTrend(range: string = "14d") {
    await delay(40);
    mockStore.requireSession();
    const redeems = mockStore.getDb().redeems;
    const now = new Date();
    const points: { date: string; label: string; count: number }[] = [];
    let total = 0;
    if (range === "today" || range === "24h") {
      const hours = range === "today" ? now.getHours() + 1 : 24;
      for (let i = hours - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 3600_000);
        d.setMinutes(0, 0, 0);
        const key = `${d.toISOString().slice(0, 13)}:00`;
        const label = `${String(d.getHours()).padStart(2, "0")}:00`;
        const count = redeems.filter((r) => {
          const t = new Date(r.createdAt);
          return (
            t.getFullYear() === d.getFullYear() &&
            t.getMonth() === d.getMonth() &&
            t.getDate() === d.getDate() &&
            t.getHours() === d.getHours()
          );
        }).length;
        total += count;
        points.push({ date: key, label, count });
      }
      return { range, bucket: "hour", total, points };
    }
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 14;
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const count = redeems.filter((r) => r.createdAt.startsWith(key)).length;
      total += count;
      points.push({ date: key, label: key.slice(5), count });
    }
    return { range, bucket: "day", total, points };
  },

  async runtimeMetrics() {
    await delay(40);
    mockStore.requireSession();
    return {
      inFlight: 1,
      requestsTotal: 1280,
      requests1m: 24,
      errors4xx: 3,
      errors5xx: 1,
      errorRatePct: 0.31,
      latencyP50Ms: 12.5,
      latencyP95Ms: 48.2,
      latencyP99Ms: 96.0,
      redeemsTotal: 420,
      redeemErrors: 8,
      loginsTotal: 15,
      dbPoolAcquired: 2,
      dbPoolIdle: 3,
      dbPoolTotal: 5,
      dbPoolMax: 20,
      redisOk: true,
      uptimeSec: 3600,
      goRoutines: 18,
      memAllocMB: 32.5,
      version: "0.1.0-mock",
      updateMode: "docker",
      checkedAt: new Date().toISOString(),
      recentErrors: [
        {
          method: "POST",
          path: "/api/v1/public/redeem",
          status: 429,
          latencyMs: 2.1,
          at: new Date(Date.now() - 12_000).toISOString(),
        },
        {
          method: "GET",
          path: "/api/v1/admin/cards",
          status: 401,
          latencyMs: 1.4,
          at: new Date(Date.now() - 45_000).toISOString(),
        },
        {
          method: "POST",
          path: "/api/v1/admin/auth/login",
          status: 401,
          latencyMs: 18.2,
          at: new Date(Date.now() - 90_000).toISOString(),
        },
      ],
    };
  },

  async checkUpdates(_force?: boolean) {
    await delay(200);
    mockStore.requireSession();
    return {
      current: "0.1.0-mock",
      latest: "0.1.0-mock",
      hasUpdate: false,
      mode: "docker",
      message: "已是最新版本",
      fromCache: false,
      authenticated: false,
      tokenRecommended: false,
    };
  },

  async updateHistory(): Promise<
    Array<{
      version: string;
      path?: string;
      modTime?: string;
      isCurrent: boolean;
      source?: string;
      canInstall?: boolean;
    }>
  > {
    await delay();
    mockStore.requireSession();
    return [
      {
        version: "0.1.0-mock",
        isCurrent: true,
        source: "local",
        canInstall: false,
      },
      {
        version: "0.0.9-mock",
        isCurrent: false,
        source: "remote",
        canInstall: true,
        modTime: new Date().toISOString(),
      },
    ];
  },

  async updateStatus() {
    return { state: "idle", progress: 0 };
  },

  async applyUpdate(_version?: string) {
    err(400, "VALIDATION_ERROR", "Mock 模式不支持在线更新");
  },

  async rollbackUpdate(_version?: string) {
    err(400, "VALIDATION_ERROR", "Mock 模式不支持回滚");
  },
};
