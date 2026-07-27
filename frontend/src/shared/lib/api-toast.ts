import { toast } from "sonner";

import { ApiError } from "@/entities/types";

/** 从未知错误提取用户可读文案 */
export function getErrorMessage(error: unknown, fallback = "操作失败"): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

/** 统一 mutation / 请求错误提示 */
export function toastApiError(error: unknown, fallback = "操作失败") {
  toast.error(getErrorMessage(error, fallback));
}
