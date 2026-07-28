import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookOpen,
  FolderTree,
  KeyRound,
  LayoutDashboard,
  Layers,
  ScrollText,
  Settings,
  Ticket,
  Upload,
} from "lucide-react";

export interface AdminNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

/** 管理端导航单一真源：桌面侧栏与移动抽屉共用 */
export const ADMIN_NAV: AdminNavItem[] = [
  { to: "/admin", label: "仪表盘", icon: LayoutDashboard, end: true },
  { to: "/admin/categories", label: "类别管理", icon: FolderTree },
  { to: "/admin/cards", label: "卡密管理", icon: Ticket },
  { to: "/admin/cards/import", label: "批量导入", icon: Upload },
  { to: "/admin/batches", label: "批次", icon: Layers },
  { to: "/admin/redeems", label: "兑换记录", icon: Activity },
  { to: "/admin/api-keys", label: "API 密钥", icon: KeyRound },
  { to: "/admin/api-docs", label: "管理 API", icon: BookOpen },
  { to: "/admin/settings", label: "系统设置", icon: Settings },
  { to: "/admin/audit", label: "审计日志", icon: ScrollText },
];