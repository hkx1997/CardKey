import { useQuery } from "@tanstack/react-query";

import { api } from "@/shared/api/client";
import { queryKeys } from "@/shared/lib/query-keys";

export function useDashboardQuery(categorySlug?: string) {
  return useQuery({
    queryKey: [...queryKeys.dashboard, categorySlug ?? "all"] as const,
    queryFn: () => api.dashboardStats(categorySlug),
  });
}
