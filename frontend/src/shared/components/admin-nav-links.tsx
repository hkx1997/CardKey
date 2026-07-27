import { NavLink } from "react-router-dom";

import { ADMIN_NAV } from "@/shared/config/admin-nav";
import { cn } from "@/shared/lib/cn";

export function AdminNavLinks({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <nav
      className={cn("space-y-1", className)}
      aria-label="主导航"
    >
      {ADMIN_NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
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
