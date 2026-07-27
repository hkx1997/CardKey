import { Badge } from "@/components/ui/badge";
import type { CardStatus } from "@/entities/types";

const map: Record<
  CardStatus,
  { label: string; variant: "success" | "secondary" | "destructive" | "warning" | "default" }
> = {
  unused: { label: "未使用", variant: "success" },
  used: { label: "已兑换", variant: "secondary" },
  disabled: { label: "已禁用", variant: "destructive" },
  expired: { label: "已过期", variant: "warning" },
};

export function CardStatusBadge({ status }: { status: CardStatus }) {
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}
