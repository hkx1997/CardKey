import { LogOut, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/shared/auth/auth-context";
import { AdminNavLinks } from "@/shared/components/admin-nav-links";
import { SiteBrand } from "@/shared/components/site-brand";
import { PageTransition } from "@/shared/components/page-transition";
import { SystemVersion } from "@/shared/components/system-version";
import { ThemeSwitcher } from "@/shared/components/theme-switcher";
import { env } from "@/shared/config/env";
import { useSettingsQuery } from "@/shared/hooks/use-settings";
import { cn } from "@/shared/lib/cn";

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const settingsQ = useSettingsQuery();
  const siteName = settingsQ.data?.siteName || "CardKey";
  const siteLogo = settingsQ.data?.siteLogo || null;

  // 路由变化时关闭抽屉
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // 打开抽屉时锁滚动
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  async function onLogout() {
    await logout();
    toast.success("已退出登录");
    navigate("/admin/login");
  }

  const accountBar = (
    <div className="flex h-10 items-center gap-0.5 px-1.5">
      <span className="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground">
        {user?.username}
      </span>
      <ThemeSwitcher />
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => void onLogout()}
        title="退出"
      >
        <LogOut className="size-4" />
      </Button>
    </div>
  );

  return (
    <div className="min-h-dvh bg-background">
      {/* 桌面侧栏 */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden h-dvh w-[288px] flex-col overflow-hidden bg-sidebar px-4 py-6 lg:flex">
        <div className="shrink-0 px-1">
          <SiteBrand name={siteName} logo={siteLogo} to="/admin" />
        </div>
        <div className="mt-7 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 pb-2">
          <AdminNavLinks />
        </div>
        <div className="relative z-10 mt-4 shrink-0 border-t border-sidebar-border pt-3 space-y-1">
          {env.isMock && (
            <div className="mb-2 rounded-md bg-secondary/55 px-2.5 py-2 text-[11px] text-muted-foreground">
              Mock · admin / admin123
            </div>
          )}
          <SystemVersion />
          {accountBar}
        </div>
      </aside>

      {/* 移动抽屉遮罩 */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] transition-opacity lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setMobileOpen(false)}
        aria-hidden={!mobileOpen}
      />

      {/* 移动侧栏 */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-dvh w-[min(288px,88vw)] flex-col bg-sidebar px-3 py-4 shadow-xl transition-transform duration-200 ease-out lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
        aria-hidden={!mobileOpen}
      >
        <div className="mb-4 flex items-center justify-between gap-2 px-1">
          <SiteBrand name={siteName} logo={siteLogo} to="/admin" />
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setMobileOpen(false)}
            aria-label="关闭菜单"
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          <AdminNavLinks onNavigate={() => setMobileOpen(false)} />
        </div>
        <div className="space-y-1 border-t border-sidebar-border pt-3">
          <SystemVersion />
          {accountBar}
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col lg:pl-[288px]">
        <header className="sticky top-0 z-20 flex h-12 items-center justify-between gap-2 border-b border-border/60 bg-background/90 px-3 backdrop-blur sm:px-4 lg:hidden">
          <div className="flex min-w-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-9 shrink-0"
              onClick={() => setMobileOpen(true)}
              aria-label="打开菜单"
            >
              <Menu className="size-5" />
            </Button>
            <span className="truncate text-sm font-semibold">{siteName}</span>
          </div>
          <div className="flex items-center gap-0.5">
            <ThemeSwitcher />
            <Button
              variant="ghost"
              size="icon"
              className="size-9"
              onClick={() => void onLogout()}
              aria-label="退出"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-12">
          <PageTransition>
            <Outlet />
          </PageTransition>
        </main>
      </div>
    </div>
  );
}
