import { KeyRound } from "lucide-react";
import { Link } from "react-router-dom";

import { cn } from "@/shared/lib/cn";

export function SiteBrand({
  name,
  logo,
  to = "/",
  className,
}: {
  name: string;
  logo?: string | null;
  to?: string;
  className?: string;
}) {
  return (
    <Link to={to} className={cn("flex items-center gap-2.5", className)}>
      {logo ? (
        <img
          src={logo}
          alt=""
          className="size-8 rounded-lg object-cover"
        />
      ) : (
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <KeyRound className="size-4" strokeWidth={1.8} />
        </div>
      )}
      <span className="text-sm font-semibold tracking-tight">{name}</span>
    </Link>
  );
}
