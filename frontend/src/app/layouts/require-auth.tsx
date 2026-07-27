import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/shared/api/client";
import { useAuth } from "@/shared/auth/auth-context";
import { env } from "@/shared/config/env";

export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const onChangePw = location.pathname.includes("/change-password");
  const [setup, setSetup] = useState<"unknown" | "need" | "ok">("unknown");

  useEffect(() => {
    if (env.isMock) {
      setSetup("ok");
      return;
    }
    void api
      .setupStatus()
      .then((s) => setSetup(s.needsSetup ? "need" : "ok"))
      .catch(() => setSetup("ok"));
  }, []);

  if (loading || setup === "unknown") {
    return (
      <div className="flex min-h-dvh items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-3">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (setup === "need") {
    return <Navigate to="/admin/setup" replace />;
  }

  if (!user) {
    return <Navigate to="/admin/login" replace state={{ from: location }} />;
  }

  if (user.mustChangePassword && !onChangePw) {
    return <Navigate to="/admin/change-password" replace />;
  }

  return <Outlet />;
}
