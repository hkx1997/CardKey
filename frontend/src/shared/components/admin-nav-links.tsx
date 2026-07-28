import { useQueryClient } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";

import { ADMIN_NAV } from "@/shared/config/admin-nav";
import { api } from "@/shared/api/client";
import { usePageSize } from "@/shared/hooks/use-page-size";
import { queryKeys } from "@/shared/lib/query-keys";
import { cn } from "@/shared/lib/cn";

/** 悬停预取：数据 + 路由 chunk 并行热身 */
function useNavPrefetch() {
  const qc = useQueryClient();
  const { pageSize } = usePageSize();
  return (path: string) => {
    const p = path.replace(/\/$/, "") || "/admin";
    if (p === "/admin" || p.endsWith("/admin")) {
      void import("@/features/dashboard/dashboard-page");
      void qc.prefetchQuery({
        queryKey: [...queryKeys.dashboard, "all"],
        queryFn: () => api.dashboardStats(),
        staleTime: 25_000,
      });
      return;
    }
    if (p.endsWith("/categories")) {
      void import("@/features/categories/categories-page");
      void qc.prefetchQuery({
        queryKey: queryKeys.categories,
        queryFn: () => api.listCategories(),
        staleTime: 45_000,
      });
      return;
    }
    if (p.endsWith("/cards") && !p.includes("import")) {
      void import("@/features/cards/cards-page");
      void qc.prefetchQuery({
        queryKey: queryKeys.cards({
          page: 1,
          pageSize,
          status: "all",
        }),
        queryFn: () =>
          api.listCards({ page: 1, pageSize, status: "all" }),
        staleTime: 30_000,
      });
      void qc.prefetchQuery({
        queryKey: [...queryKeys.categories, "light"] as const,
        queryFn: () => api.listCategories({ light: true }),
        staleTime: 60_000,
      });
      return;
    }
    if (p.endsWith("/import")) {
      void import("@/features/cards/import-page");
      return;
    }
    if (p.endsWith("/batches")) {
      void import("@/features/batches/batches-page");
      void qc.prefetchQuery({
        queryKey: [...queryKeys.batches, "all"],
        queryFn: () => api.listBatches(),
        staleTime: 45_000,
      });
      return;
    }
    if (p.endsWith("/redeems")) {
      void import("@/features/redeems/redeems-page");
      void qc.prefetchQuery({
        queryKey: queryKeys.redeems({ page: 1, pageSize }),
        queryFn: () => api.listRedeems({ page: 1, pageSize }),
        staleTime: 30_000,
      });
      return;
    }
    if (p.endsWith("/api-keys")) {
      void import("@/features/api-keys/api-keys-page");
      void qc.prefetchQuery({
        queryKey: queryKeys.apiKeys,
        queryFn: () => api.listApiKeys(),
        staleTime: 45_000,
      });
      return;
    }
    if (p.endsWith("/settings")) {
      void import("@/features/settings/settings-page");
      void qc.prefetchQuery({
        queryKey: queryKeys.settings,
        queryFn: () => api.getSettings(),
        staleTime: 60_000,
      });
      return;
    }
    if (p.endsWith("/audit")) {
      void import("@/features/audit/audit-page");
      void qc.prefetchQuery({
        queryKey: queryKeys.audit({ page: 1, pageSize }),
        queryFn: () => api.listAuditLogs({ page: 1, pageSize }),
        staleTime: 30_000,
      });
    }
  };
}

export function AdminNavLinks({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  const prefetch = useNavPrefetch();

  return (
    <nav className={cn("space-y-1", className)} aria-label="主导航">
      {ADMIN_NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          onPointerEnter={() => prefetch(item.to)}
          onFocus={() => prefetch(item.to)}
          className={({ isActive }) =>
            cn(
              "group flex h-10 items-center gap-2.5 rounded-md px-3 text-sm font-normal text-muted-foreground",
              "transition-[background-color,color,transform] duration-150 ease-out",
              "hover:bg-secondary/70 hover:text-foreground",
              "active:scale-[0.98] active:bg-secondary/80",
              "lg:h-8 lg:px-2.5 lg:text-xs",
              isActive && "bg-secondary/75 text-foreground shadow-xs font-medium",
            )
          }
        >
          {({ isActive }) => (
            <>
              <span className="flex size-5 shrink-0 items-center justify-center">
                <item.icon
                  className={cn(
                    "size-4 text-muted-foreground",
                    isActive && "text-foreground",
                  )}
                  strokeWidth={1.8}
                  fill={isActive ? "currentColor" : "none"}
                  fillOpacity={isActive ? 0.14 : 0}
                />
              </span>
              {item.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
