import {
  Box,
  Gift,
  KeyRound,
  Package,
  Shield,
  Sparkles,
  Star,
  Ticket,
  User,
  Zap,
  Crown,
  Gamepad2,
  type LucideIcon,
} from "lucide-react";

import type { CategoryIcon } from "@/entities/types";
import { cn } from "@/shared/lib/cn";

export const LUCIDE_ICON_MAP: Record<string, LucideIcon> = {
  ticket: Ticket,
  key: KeyRound,
  gift: Gift,
  star: Star,
  zap: Zap,
  shield: Shield,
  user: User,
  package: Package,
  box: Box,
  sparkles: Sparkles,
  crown: Crown,
  gamepad: Gamepad2,
};

export const LUCIDE_ICON_OPTIONS = Object.keys(LUCIDE_ICON_MAP);

export function CategoryIconView({
  icon,
  className,
  size = 16,
}: {
  icon?: CategoryIcon | null;
  className?: string;
  size?: number;
}) {
  // 兼容 icon 缺失 / 自定义图 value 被截断为空 → 回退默认 lucide
  const radius = size >= 22 ? "rounded-lg" : size >= 18 ? "rounded-md" : "rounded";
  if (icon?.kind === "image" && icon.value) {
    return (
      <img
        src={icon.value}
        alt=""
        width={size}
        height={size}
        className={cn(
          "shrink-0 object-cover ring-1 ring-black/5 dark:ring-white/10",
          radius,
          className,
        )}
        style={{ width: size, height: size }}
        draggable={false}
      />
    );
  }
  const lucideName =
    icon?.kind === "lucide" && icon.value ? icon.value : "ticket";
  const Icon = LUCIDE_ICON_MAP[lucideName] ?? Ticket;
  return (
    <Icon
      className={cn("shrink-0", className)}
      size={size}
      strokeWidth={size >= 22 ? 1.7 : 1.8}
    />
  );
}
