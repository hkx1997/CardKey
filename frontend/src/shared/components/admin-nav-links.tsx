import { useQueryClient } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";

import { ADMIN_NAV } from "@/shared/config/admin-nav";
import { api } from "@/shared/api/client";
import { queryKeys } from "@/shared/lib/query-keys";
import { cn } from "@/shared/lib/cn";

/** 悬停预取：进入页面前热身数据，降低「点了再等」 */
function useNavPrefetch() {
  const qc = useQueryClient();
  return (path: string) => {
    const p = path.replace(/\/$/, "") || "/admin";
    if (p === "/admin" || p.endsWith("/admin")) {
      void qc.prefetchQuery({
        queryKey: [...queryKeys.dashboard, "all"],
        queryFn: () => api.dashboardStats(),
        staleTime: 25_000,
      });
      return;
    }
    if (p.endsWith("/categories")) {
      void qc.prefetchQuery({
        queryKey: queryKeys.categories,
        queryFn: () => api.listCategories(),
        staleTime: 45_000,
      });
      return;
    }
    if (p.endsWith("/cards") && !p.includes("import")) {
      void qc.prefetchQuery({
        queryKey: queryKeys.cards({
          page: 1,
          pageSize: 20,
          status: "all",
        }),
        queryFn: () =>
          api.listCards({ page: 1, pageSize: 20, status: "all" }),
        staleTime: 30_000,
      });
      void qc.prefetchQuery({
        queryKey: [...queryKeys.categories, "light"] as const,
        queryFn: () => api.listCategories({ light: true }),
        staleTime: 60_000,
      });
      return;
    }
    if (p.endsWith("/batches")) {
      void qc.prefetchQuery({
        queryKey: [...queryKeys.batches, "all"],
        queryFn: () => api.listBatches(),
        staleTime: 45_000,
      });
      return;
    }
    if (p.endsWith("/redeems")) {
      void qc.prefetchQuery({
        queryKey: queryKeys.redeems({ page: 1, pageSize: 20 }),
        queryFn: () => api.listRedeems({ page: 1, pageSize: 20 }),
        staleTime: 30_000,
      });
      return;
    }
    if (p.endsWith("/api-keys")) {
      void qc.prefetchQuery({
        queryKey: queryKeys.apiKeys,
        queryFn: () => api.listApiKeys(),
        staleTime: 45_000,
      });
      return;
    }
    if (p.endsWith("/settings")) {
      void qc.prefetchQuery({
        queryKey: queryKeys.settings,
        queryFn: () => api.getSettings(),
        staleTime: 60_000,
      });
      return;
    }
    if (p.endsWith("/audit")) {
      void qc.prefetchQuery({
        queryKey: queryKeys.audit({ page: 1, pageSize: 20 }),
        queryFn: () => api.listAuditLogs({ page: 1, pageSize: 20 }),
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
