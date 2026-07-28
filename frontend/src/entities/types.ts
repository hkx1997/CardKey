/** 领域类型 — 前后端契约单一真源（前端侧） */

export type CardStatus = "unused" | "used" | "disabled" | "expired";
/** text/txt/json/account 为文本；image/zip/pdf/file 为二进制（兑换可下载） */
export type CardType =
  | "text"
  | "txt"
  | "json"
  | "account"
  | "image"
  | "zip"
  | "pdf"
  | "file";
export type CategoryIconKind = "lucide" | "image";
export type ApiScope = "redeem:api" | "admin:api";

export interface CategoryIcon {
  kind: CategoryIconKind;
  value: string;
}

export interface AdminUser {
  id: string;
  username: string;
  mustChangePassword: boolean;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  codePrefix: string;
  /** 富文本 HTML，兑换端 Tab 下方展示 */
  description: string;
  enabled: boolean;
  sortOrder: number;
  icon: CategoryIcon;
  cardCount?: number;
  unusedCount?: number;
  usedCount?: number;
  createdAt: string;
}

export interface PublicCategory {
  slug: string;
  name: string;
  codePrefix: string;
  /** 富文本 HTML */
  description: string;
  icon: CategoryIcon;
  /** 可兑换库存（未使用且未过期） */
  unusedCount?: number;
}

/** 兑换端轮询用的轻量库存 */
export interface PublicCategoryStockItem {
  slug: string;
  unusedCount: number;
}

export interface PublicStock {
  categories: PublicCategoryStockItem[];
  updatedAt: string;
}

/** 公开端可读配置（由系统设置投影） */
export interface PublicConfig {
  siteName: string;
  siteLogo: string | null;
  siteFavicon: string | null;
  footerText: string;
  /** 浏览器标签标题；空则用 siteName */
  documentTitle?: string;
  redeemTitle: string;
  redeemSubtitle: string;
  redeemSuccessHint: string;
  redeemPlaceholder: string;
  redeemButtonText: string;
  redeemTabVisibleCount: number;
  captchaEnabled: boolean;
  categories: PublicCategory[];
  apiBasePath: string;
  /** 对外 API 根，如 https://api.example.com；空则用当前 origin */
  apiPublicBaseUrl?: string;
  apiDocsEnabled: boolean;
  /** 兑换页是否显示「API 文档」入口 */
  showApiDocsEntry: boolean;
  publicRedeemApiKey?: string | null;
  rateLimitIpPerMin: number;
  rateLimitCodePerMin: number;
}

export interface Card {
  id: string;
  categoryId: string;
  categorySlug?: string;
  categoryName?: string;
  code: string;
  type: CardType;
  /** reveal 时返回；二进制为 base64 */
  content?: string;
  contentEncoding?: "utf8" | "base64" | string;
  filename?: string;
  mime?: string;
  size?: number;
  status: CardStatus;
  batchId: string | null;
  batchName?: string | null;
  note: string;
  expiresAt: string | null;
  usedAt: string | null;
  usedIp: string | null;
  createdAt: string;
}

export interface Batch {
  id: string;
  categoryId: string;
  categoryName?: string;
  name: string;
  note: string;
  cardCount: number;
  unusedCount: number;
  createdAt: string;
}

export interface RedeemRecord {
  id: string;
  categoryId: string;
  categorySlug?: string;
  categoryName?: string;
  cardId: string;
  code: string;
  ip: string;
  userAgent: string;
  createdAt: string;
}

export interface ApiKeyMeta {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: ApiScope[];
  isSystemRedeemKey?: boolean;
  /**
   * 完整密钥（管理端展示/复制）。
   * 生产可改为「仅创建/轮换时返回一次」；Mock 持久保存便于运维。
   */
  secret?: string;
  rateLimitRpm: number | null;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorType: "admin" | "api_key" | "system";
  actorLabel: string;
  action: string;
  resource: string;
  detail: string;
  ip: string;
  createdAt: string;
}

export interface DashboardStats {
  totalCards: number;
  unusedCards: number;
  usedCards: number;
  disabledCards: number;
  expiredCards: number;
  todayRedeems: number;
  yesterdayRedeems: number;
  weekRedeems: number;
  totalRedeems: number;
  redeemRate: number;
  totalCategories: number;
  enabledCategories: number;
  activeApiKeys: number;
  trend: { date: string; count: number }[];
  byCategory: {
    slug: string;
    name: string;
    icon: CategoryIcon;
    unused: number;
    used: number;
    total: number;
    redeemRate: number;
  }[];
  recentRedeems: RedeemRecord[];
  statusBreakdown: { status: CardStatus; count: number }[];
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RedeemResult {
  status: "success" | "already_redeemed";
  category: string;
  categoryName: string;
  code: string;
  type: CardType;
  content: string;
  /** utf8 | base64；二进制内容为 base64 */
  contentEncoding?: "utf8" | "base64" | string;
  filename?: string;
  mime?: string;
  size?: number;
  redeemedAt: string;
}

/**
 * 系统设置 — 尽量全部可配置，避免写死在前端
 */
export interface Settings {
  /* 品牌 */
  siteName: string;
  siteLogo: string;
  siteFavicon: string;
  footerText: string;
  documentTitle: string;

  /* 兑换页文案 */
  redeemTitle: string;
  redeemSubtitle: string;
  redeemSuccessHint: string;
  redeemPlaceholder: string;
  redeemButtonText: string;
  redeemTabVisibleCount: number;

  /* 安全 */
  captchaEnabled: boolean;
  allowRequery: boolean;
  rateLimitIpPerMin: number;
  rateLimitCodePerMin: number;
  rateLimitFailClosed: boolean;
  maskCardErrors: boolean;

  /* API 文档 */
  apiDocsEnabled: boolean;
  showApiDocsEntry: boolean;
  exposePublicRedeemKeyInDocs: boolean;
  publicRedeemApiKey: string;
  apiBasePath: string;
  /** 对外 API 根地址（文档/SDK 示例用） */
  apiPublicBaseUrl: string;

  /* 邮件 SMTP（对齐 sub2api 形态） */
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  /** 仅写入；读取恒为空 */
  smtpPassword: string;
  smtpPasswordSet: boolean;
  smtpFromEmail: string;
  smtpFromName: string;
  smtpUseTLS: boolean;
  smtpSkipTlsVerify: boolean;
  /** 预警收件人，逗号分隔 */
  mailNotifyTo: string;
  /** 平台健康预警 */
  mailHealthAlertEnabled: boolean;
  /** 卡密库存预警 */
  mailCardAlertEnabled: boolean;
  /** 5xx 比例阈值 %；0=只检连通 */
  mailHealthErrorRatePct: number;
  /** 未使用库存 ≤ 该值告警 */
  mailCardUnusedThreshold: number;
  /** 需要库存预警的类别 id；空数组 = 全部启用类别 */
  mailCardAlertCategoryIds: string[];
  /** 同类预警冷却分钟 */
  mailAlertCooldownMinutes: number;
}

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  meta?: {
    request_id?: string;
    page?: number;
    page_size?: number;
    total?: number;
  };
  request_id?: string;
}
