import { useQuery } from "@tanstack/react-query";

import { api } from "@/shared/api/client";
import { queryKeys } from "@/shared/lib/query-keys";

export function useAuditQuery(params: { page: number; pageSize: number }) {
  return useQuery({
    queryKey: queryKeys.audit(params),
    queryFn: () => api.listAuditLogs(params),
  });
}
