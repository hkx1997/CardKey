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
  icon: CategoryIcon;
  className?: string;
  size?: number;
}) {
  if (icon.kind === "image" && icon.value) {
    return (
      <img
        src={icon.value}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 rounded object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  const Icon = LUCIDE_ICON_MAP[icon.value] ?? Ticket;
  return (
    <Icon
      className={cn("shrink-0", className)}
      size={size}
      strokeWidth={1.8}
    />
  );
}
