import { format, formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return format(d, "yyyy-MM-dd HH:mm:ss");
}

export function formatRelative(value: string | Date | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return formatDistanceToNow(d, { addSuffix: true, locale: zhCN });
}

export function maskCode(code: string) {
  if (code.length <= 8) return code;
  return `${code.slice(0, 7)}…${code.slice(-4)}`;
}
