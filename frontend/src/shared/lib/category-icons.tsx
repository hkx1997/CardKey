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
  /**
   * 图片适配：contain 适合品牌 Logo（完整可见、更清晰）；
   * cover 适合方形头像裁切。兑换端自定义图默认 contain。
   */
  fit = "contain",
}: {
  icon?: CategoryIcon | null;
  className?: string;
  size?: number;
  fit?: "contain" | "cover";
}) {
  // 兼容 icon 缺失 / 自定义图 value 被截断为空 → 回退默认 lucide
  // size 必须作用在图标/img 本身
  const radius =
    size >= 28 ? "rounded-lg" : size >= 22 ? "rounded-md" : "rounded";
  if (icon?.kind === "image" && icon.value) {
    return (
      <img
        src={icon.value}
        alt=""
        width={size}
        height={size}
        className={cn(
          "shrink-0 bg-background/40",
          fit === "cover" ? "object-cover" : "object-contain",
          radius,
          className,
        )}
        style={{
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
        }}
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
      width={size}
      height={size}
      strokeWidth={size >= 24 ? 1.65 : size >= 20 ? 1.75 : 1.8}
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
    />
  );
}
