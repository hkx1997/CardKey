import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().trim().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
});

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1, "请输入名称").max(64, "名称过长"),
  slug: z
    .string()
    .trim()
    .min(1, "请输入 Slug")
    .max(32)
    .regex(/^[a-z0-9-]+$/, "仅小写字母、数字与连字符"),
  codePrefix: z
    .string()
    .trim()
    .min(1, "请输入前缀")
    .max(8)
    .regex(/^[A-Z0-9]+$/, "仅大写字母与数字"),
  description: z.string().optional().default(""),
});

export const categoryUpdateSchema = z.object({
  name: z.string().trim().min(1, "请输入名称").max(64),
  description: z.string().optional().default(""),
});

export const cardCreateSchema = z.object({
  categoryId: z.string().min(1, "请选择类别"),
  content: z.string().trim().min(1, "请输入卡密内容"),
  type: z.enum(["text", "json", "account"]),
  note: z.string().optional().default(""),
});

export const importCardsSchema = z.object({
  categoryId: z.string().min(1, "请选择类别"),
  raw: z.string().trim().min(1, "请输入导入内容"),
  type: z.enum(["text", "json", "account"]),
  batchName: z.string().trim().min(1, "请输入批次名称").max(64),
  note: z.string().optional().default(""),
});

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1, "请输入名称").max(64),
  scopes: z
    .array(z.enum(["redeem:api", "admin:api"]))
    .min(1, "至少选择一个权限"),
});

export const redeemSchema = z.object({
  category: z.string().min(1, "请选择类别"),
  code: z.string().trim().min(4, "请输入兑换码"),
});

export const customApiKeySchema = z
  .string()
  .trim()
  .min(16, "密钥至少 16 位");

export type LoginInput = z.infer<typeof loginSchema>;
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export type CardCreateInput = z.infer<typeof cardCreateSchema>;
export type ImportCardsInput = z.infer<typeof importCardsSchema>;
export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>;
export type RedeemInput = z.infer<typeof redeemSchema>;

/** 安全 parse：返回字段错误 map */
export function fieldErrors<T extends z.ZodType>(
  schema: T,
  data: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; errors: Record<string, string> } {
  const r = schema.safeParse(data);
  if (r.success) return { ok: true, data: r.data };
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = String(issue.path[0] ?? "_form");
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}
