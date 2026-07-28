import { useQuery } from "@tanstack/react-query";

import { api } from "@/shared/api/client";
import { queryKeys } from "@/shared/lib/query-keys";

export function useRedeemsQuery(params: {
  page: number;
  pageSize: number;
  q?: string;
  categorySlug?: string;
}) {
  return useQuery({
    queryKey: queryKeys.redeems(params),
    queryFn: () => api.listRedeems(params),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    meta: { toastError: true },
  });
}
