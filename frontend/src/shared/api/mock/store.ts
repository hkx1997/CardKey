import type {
  AdminUser,
  ApiKeyMeta,
  AuditLog,
  Batch,
  Card,
  CardStatus,
  CardType,
  Category,
  CategoryIcon,
  RedeemRecord,
  Settings,
} from "@/entities/types";

const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randId() {
  return crypto.randomUUID();
}

function randSegment(len = 4) {
  let s = "";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) {
    s += CHARSET[arr[i]! % CHARSET.length];
  }
  return s;
}

export function generateCode(prefix: string) {
  const p = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${p}-${randSegment()}-${randSegment()}-${randSegment()}-${randSegment()}`;
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function hoursAgo(n: number) {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d.toISOString();
}

function icon(value: string, kind: CategoryIcon["kind"] = "lucide"): CategoryIcon {
  return { kind, value };
}

const catVip: Category = {
  id: "cat-vip",
  name: "会员卡",
  slug: "vip",
  codePrefix: "VIP",
  description:
    "<p><strong>会员权益说明</strong></p><ul><li>兑换后立即生效</li><li>请妥善保存账号信息</li></ul>",
  enabled: true,
  sortOrder: 1,
  icon: icon("crown"),
  createdAt: daysAgo(10),
};

const catCdk: Category = {
  id: "cat-cdk",
  name: "激活码",
  slug: "cdk",
  codePrefix: "CDK",
  description:
    "<p>用于软件激活，兑换后将获得一串 <em>激活密钥</em>。</p>",
  enabled: true,
  sortOrder: 2,
  icon: icon("key"),
  createdAt: daysAgo(8),
};

const catGift: Category = {
  id: "cat-gift",
  name: "礼品卡",
  slug: "gift",
  codePrefix: "GFT",
  description: "<p>礼品兑换专用，请在有效期内使用。</p>",
  enabled: true,
  sortOrder: 3,
  icon: icon("gift"),
  createdAt: daysAgo(7),
};

const catGame: Category = {
  id: "cat-game",
  name: "游戏点券",
  slug: "game",
  codePrefix: "GAM",
  description: "<p>游戏内道具与点券兑换。</p>",
  enabled: true,
  sortOrder: 4,
  icon: icon("gamepad"),
  createdAt: daysAgo(6),
};

const catSpark: Category = {
  id: "cat-spark",
  name: "限时活动",
  slug: "event",
  codePrefix: "EVT",
  description: "<p><u>限时活动</u>专属卡密，活动结束后可能无法兑换。</p>",
  enabled: true,
  sortOrder: 5,
  icon: icon("sparkles"),
  createdAt: daysAgo(5),
};

const catAcc: Category = {
  id: "cat-acc",
  name: "账号密",
  slug: "account",
  codePrefix: "ACC",
  description: "<p>成品账号（已停用）</p>",
  enabled: false,
  sortOrder: 6,
  icon: icon("user"),
  createdAt: daysAgo(4),
};

interface RateBucket {
  count: number;
  windowStart: number;
}

interface MockDb {
  admin: AdminUser & { password: string };
  session: AdminUser | null;
  settings: Settings;
  categories: Category[];
  batches: Batch[];
  cards: Card[];
  redeems: RedeemRecord[];
  apiKeys: ApiKeyMeta[];
  audit: AuditLog[];
  /** 简易限流：key → 滑动窗口计数 */
  rateBuckets: Record<string, RateBucket>;
}

function isAvailableUnused(card: Card) {
  if (card.status !== "unused") return false;
  if (!card.expiresAt) return true;
  return new Date(card.expiresAt).getTime() > Date.now();
}

function recomputeCounts(db: MockDb) {
  for (const c of db.categories) {
    const list = db.cards.filter((x) => x.categoryId === c.id);
    c.cardCount = list.length;
    c.unusedCount = list.filter((x) => isAvailableUnused(x)).length;
    c.usedCount = list.filter((x) => x.status === "used").length;
  }
  for (const b of db.batches) {
    const list = db.cards.filter((c) => c.batchId === b.id);
    b.cardCount = list.length;
    b.unusedCount = list.filter((c) => c.status === "unused").length;
  }
}

function makeCard(
  partial: Omit<Card, "id" | "createdAt"> & { id?: string; createdAt?: string },
): Card {
  return {
    id: partial.id ?? randId(),
    createdAt: partial.createdAt ?? daysAgo(2),
    ...partial,
  };
}

function createDb(): MockDb {
  const batchVip: Batch = {
    id: "batch-vip-1",
    categoryId: catVip.id,
    categoryName: catVip.name,
    name: "2026-07 会员体验",
    note: "演示",
    cardCount: 0,
    unusedCount: 0,
    createdAt: daysAgo(5),
  };
  const batchCdk: Batch = {
    id: "batch-cdk-1",
    categoryId: catCdk.id,
    categoryName: catCdk.name,
    name: "激活码批次 A",
    note: "",
    cardCount: 0,
    unusedCount: 0,
    createdAt: daysAgo(3),
  };

  const cards: Card[] = [
    makeCard({
      id: "card-1",
      categoryId: catVip.id,
      categorySlug: catVip.slug,
      categoryName: catVip.name,
      code: "VIP-DEMO-7K3M-9P2X-W4QH",
      type: "text",
      content: "【会员卡】欢迎使用 CardKey VIP 权益。",
      status: "unused",
      batchId: batchVip.id,
      batchName: batchVip.name,
      note: "演示 VIP",
      expiresAt: null,
      usedAt: null,
      usedIp: null,
      createdAt: daysAgo(4),
    }),
    makeCard({
      id: "card-2",
      categoryId: catVip.id,
      categorySlug: catVip.slug,
      categoryName: catVip.name,
      code: "VIP-USED-AAAA-BBBB-CCCC",
      type: "json",
      content: JSON.stringify({ plan: "vip", days: 30 }, null, 2),
      status: "used",
      batchId: batchVip.id,
      batchName: batchVip.name,
      note: "",
      expiresAt: null,
      usedAt: hoursAgo(6),
      usedIp: "203.0.113.10",
      createdAt: daysAgo(4),
    }),
    makeCard({
      id: "card-3",
      categoryId: catCdk.id,
      categorySlug: catCdk.slug,
      categoryName: catCdk.name,
      code: "CDK-DEMO-A2B3-C4D5-E6F7",
      type: "text",
      content: "XXXXX-YYYYY-ZZZZZ-激活码演示",
      status: "unused",
      batchId: batchCdk.id,
      batchName: batchCdk.name,
      note: "演示 CDK",
      expiresAt: null,
      usedAt: null,
      usedIp: null,
    }),
    makeCard({
      id: "card-4",
      categoryId: catCdk.id,
      categorySlug: catCdk.slug,
      categoryName: catCdk.name,
      code: generateCode("CDK"),
      type: "text",
      content: "已禁用的 CDK",
      status: "disabled",
      batchId: batchCdk.id,
      batchName: batchCdk.name,
      note: "风控",
      expiresAt: null,
      usedAt: null,
      usedIp: null,
    }),
    makeCard({
      id: "card-5",
      categoryId: catVip.id,
      categorySlug: catVip.slug,
      categoryName: catVip.name,
      code: generateCode("VIP"),
      type: "account",
      content: "user: vip@demo.com\npass: Demo@VIP",
      status: "expired",
      batchId: batchVip.id,
      batchName: batchVip.name,
      note: "",
      expiresAt: daysAgo(1),
      usedAt: null,
      usedIp: null,
      createdAt: daysAgo(3),
    }),
    makeCard({
      id: "card-6",
      categoryId: catGift.id,
      categorySlug: catGift.slug,
      categoryName: catGift.name,
      code: generateCode("GFT"),
      type: "text",
      content: "礼品卡面值 100",
      status: "unused",
      batchId: null,
      note: "",
      expiresAt: null,
      usedAt: null,
      usedIp: null,
    }),
    makeCard({
      id: "card-7",
      categoryId: catGame.id,
      categorySlug: catGame.slug,
      categoryName: catGame.name,
      code: generateCode("GAM"),
      type: "text",
      content: "游戏点券 x500",
      status: "used",
      batchId: null,
      note: "",
      expiresAt: null,
      usedAt: hoursAgo(20),
      usedIp: "198.51.100.2",
    }),
    makeCard({
      id: "card-8",
      categoryId: catSpark.id,
      categorySlug: catSpark.slug,
      categoryName: catSpark.name,
      code: generateCode("EVT"),
      type: "text",
      content: "活动奖励包",
      status: "unused",
      batchId: null,
      note: "",
      expiresAt: null,
      usedAt: null,
      usedIp: null,
    }),
  ];

  // 补更多已兑记录用于仪表盘
  for (let i = 0; i < 12; i++) {
    const day = (i % 7) + 1;
    cards.push(
      makeCard({
        categoryId: catVip.id,
        categorySlug: catVip.slug,
        categoryName: catVip.name,
        code: generateCode("VIP"),
        type: "text",
        content: `历史卡 ${i}`,
        status: "used",
        batchId: batchVip.id,
        batchName: batchVip.name,
        note: "",
        expiresAt: null,
        usedAt: daysAgo(day),
        usedIp: `203.0.113.${10 + i}`,
        createdAt: daysAgo(day + 2),
      }),
    );
  }

  const usedCards = cards.filter((c) => c.status === "used");
  const redeems: RedeemRecord[] = usedCards.map((c, i) => ({
    id: `redeem-${i}`,
    categoryId: c.categoryId,
    categorySlug: c.categorySlug,
    categoryName: c.categoryName,
    cardId: c.id,
    code: c.code,
    ip: c.usedIp ?? "127.0.0.1",
    userAgent: i % 2 === 0 ? "Mozilla/5.0 (Demo)" : "CardKey-SDK/1.0",
    createdAt: c.usedAt!,
  }));
  redeems.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const db: MockDb = {
    admin: {
      id: "admin-1",
      username: "admin",
      password: "admin123",
      mustChangePassword: false,
    },
    session: null,
    settings: {
      siteName: "CardKey",
      siteLogo: "",
      siteFavicon: "",
      footerText: "",
      documentTitle: "CardKey",
      redeemTitle: "卡密兑换",
      redeemSubtitle: "选择类别并输入兑换编码",
      redeemSuccessHint: "兑换成功",
      redeemPlaceholder: "",
      redeemButtonText: "立即兑换",
      redeemTabVisibleCount: 4,
      captchaEnabled: false,
      allowRequery: true,
      rateLimitIpPerMin: 30,
      rateLimitCodePerMin: 10,
      rateLimitFailClosed: true,
      maskCardErrors: true,
      redeemWebhookUrl: "",
      redeemWebhookSecret: "",
      apiDocsEnabled: true,
      showApiDocsEntry: true,
      exposePublicRedeemKeyInDocs: false,
      publicRedeemApiKey: "ck_redeem_demo_fixed_key_change_me",
      apiBasePath: "/api/v1",
      apiPublicBaseUrl: "",
      smtpHost: "",
      smtpPort: 587,
      smtpUsername: "",
      smtpPassword: "",
      smtpPasswordSet: false,
      smtpFromEmail: "",
      smtpFromName: "CardKey",
      smtpUseTLS: true,
      smtpSkipTlsVerify: false,
      mailNotifyTo: "",
      mailHealthAlertEnabled: false,
      mailCardAlertEnabled: false,
      mailHealthErrorRatePct: 10,
      mailCardUnusedThreshold: 10,
      mailCardAlertCategoryIds: [],
      mailAlertCooldownMinutes: 60,
    },
    categories: [catVip, catCdk, catGift, catGame, catSpark, catAcc],
    batches: [batchVip, batchCdk],
    cards,
    redeems,
    apiKeys: [
      {
        id: "key-system-redeem",
        name: "兑换端固定密钥",
        keyPrefix: "ck_redeem_demo",
        scopes: ["redeem:api"],
        isSystemRedeemKey: true,
        secret: "ck_redeem_demo_fixed_key_change_me",
        rateLimitRpm: 120,
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: hoursAgo(2),
        createdAt: daysAgo(10),
      },
      {
        id: "key-1",
        name: "发货系统",
        keyPrefix: "ck_live_a1b2c3d4",
        scopes: ["admin:api", "redeem:api"],
        secret: "ck_live_a1b2c3d4e5f6789012345678abcd",
        rateLimitRpm: 120,
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: hoursAgo(20),
        createdAt: daysAgo(3),
      },
      {
        id: "key-2",
        name: "仅兑换对接",
        keyPrefix: "ck_live_c3d4e5f6",
        scopes: ["redeem:api"],
        secret: "ck_live_c3d4e5f6789012345678ef01",
        rateLimitRpm: 60,
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: daysAgo(1),
      },
    ],
    audit: [
      {
        id: "audit-1",
        actorType: "system",
        actorLabel: "system",
        action: "bootstrap",
        resource: "admin",
        detail: "演示环境已初始化",
        ip: "127.0.0.1",
        createdAt: daysAgo(5),
      },
    ],
    rateBuckets: {},
  };
  recomputeCounts(db);
  return db;
}

const globalKey = "__cardkey_mock_db_v6__";

function getDb(): MockDb {
  const g = globalThis as unknown as Record<string, MockDb | undefined>;
  if (!g[globalKey]) {
    g[globalKey] = createDb();
  }
  return g[globalKey]!;
}

export function delay(ms = 240) {
  return new Promise((r) => setTimeout(r, ms));
}

export function pushAudit(
  partial: Omit<AuditLog, "id" | "createdAt"> & { createdAt?: string },
) {
  const db = getDb();
  db.audit.unshift({
    id: randId(),
    createdAt: partial.createdAt ?? new Date().toISOString(),
    ...partial,
  });
}

/** 固定窗口限流：true 表示通过 */
export function checkRateLimit(
  key: string,
  limitPerMin: number,
): boolean {
  if (limitPerMin <= 0) return true;
  const db = getDb();
  const now = Date.now();
  const windowMs = 60_000;
  let b = db.rateBuckets[key];
  if (!b || now - b.windowStart >= windowMs) {
    db.rateBuckets[key] = { count: 1, windowStart: now };
    return true;
  }
  if (b.count >= limitPerMin) return false;
  b.count += 1;
  return true;
}

export const mockStore = {
  getDb,
  recomputeCounts,
  generateCode,
  randId,
  checkRateLimit,
  /** 类别可兑换库存（unused 且未过期） */
  availableStock(categoryId: string) {
    return getDb().cards.filter(
      (c) => c.categoryId === categoryId && isAvailableUnused(c),
    ).length;
  },
  requireSession(): AdminUser {
    const db = getDb();
    if (!db.session) {
      throw Object.assign(new Error("未登录"), {
        code: "UNAUTHORIZED",
        status: 401,
      });
    }
    return db.session;
  },
  normalizeCode(code: string) {
    return code.trim().toUpperCase().replace(/\s+/g, "");
  },
  findCategoryBySlug(slug: string) {
    return getDb().categories.find((c) => c.slug === slug);
  },
  findCategoryById(id: string) {
    return getDb().categories.find((c) => c.id === id);
  },
  listCards(params: {
    page: number;
    pageSize: number;
    status?: CardStatus | "all";
    q?: string;
    batchId?: string;
    categorySlug?: string;
  }) {
    const db = getDb();
    let items = [...db.cards];
    if (params.categorySlug) {
      const cat = this.findCategoryBySlug(params.categorySlug);
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
    items.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const total = items.length;
    const start = (params.page - 1) * params.pageSize;
    return {
      items: items.slice(start, start + params.pageSize).map((c) => ({
        ...c,
        content: undefined,
      })),
      total,
      page: params.page,
      pageSize: params.pageSize,
    };
  },
  createCard(input: {
    content: string;
    type: CardType;
    note?: string;
    batchId?: string | null;
    categoryId: string;
    expiresAt?: string | null;
    contentEncoding?: string;
    filename?: string;
    mime?: string;
  }) {
    const db = getDb();
    const cat = this.findCategoryById(input.categoryId);
    if (!cat)
      throw Object.assign(new Error("类别不存在"), {
        code: "NOT_FOUND",
        status: 404,
      });
    const batch = input.batchId
      ? db.batches.find((b) => b.id === input.batchId)
      : undefined;
    if (batch && batch.categoryId !== cat.id) {
      throw Object.assign(new Error("批次与类别不匹配"), {
        code: "VALIDATION_ERROR",
        status: 400,
      });
    }
    const binary = ["image", "zip", "pdf", "file"].includes(input.type);
    const card: Card = {
      id: randId(),
      categoryId: cat.id,
      categorySlug: cat.slug,
      categoryName: cat.name,
      code: generateCode(cat.codePrefix),
      type: input.type,
      content: input.content,
      contentEncoding:
        input.contentEncoding || (binary ? "base64" : "utf8"),
      filename: input.filename,
      mime: input.mime,
      size: binary
        ? Math.floor((input.content.length * 3) / 4)
        : input.content.length,
      status: "unused",
      batchId: batch?.id ?? null,
      batchName: batch?.name ?? null,
      note: input.note ?? "",
      expiresAt: input.expiresAt ?? null,
      usedAt: null,
      usedIp: null,
      createdAt: new Date().toISOString(),
    };
    db.cards.unshift(card);
    recomputeCounts(db);
    return card;
  },
  importCards(input: {
    lines: string[];
    type: CardType;
    categoryId: string;
    batchName?: string;
    note?: string;
  }) {
    const db = getDb();
    const cat = this.findCategoryById(input.categoryId);
    if (!cat)
      throw Object.assign(new Error("类别不存在"), {
        code: "NOT_FOUND",
        status: 404,
      });
    let batch: Batch | undefined;
    if (input.batchName?.trim()) {
      batch = {
        id: randId(),
        categoryId: cat.id,
        categoryName: cat.name,
        name: input.batchName.trim(),
        note: input.note ?? "",
        cardCount: 0,
        unusedCount: 0,
        createdAt: new Date().toISOString(),
      };
      db.batches.unshift(batch);
    }
    const created: Card[] = [];
    for (const line of input.lines) {
      const content = line.trim();
      if (!content) continue;
      created.push(
        this.createCard({
          content,
          type: input.type,
          note: input.note,
          batchId: batch?.id ?? null,
          categoryId: cat.id,
        }),
      );
    }
    recomputeCounts(db);
    return { batch, cards: created, category: cat };
  },
};
