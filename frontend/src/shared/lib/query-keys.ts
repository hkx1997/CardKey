/** React Query 键单一真源，避免字符串散落 */
export const queryKeys = {
  publicConfig: ["public-config"] as const,
  settings: ["settings"] as const,
  dashboard: ["dashboard"] as const,
  categories: ["categories"] as const,
  cards: (params?: unknown) =>
    params === undefined ? (["cards"] as const) : (["cards", params] as const),
  card: (id: string, reveal?: boolean) => ["card", id, reveal] as const,
  batches: ["batches"] as const,
  redeems: (params?: unknown) =>
    params === undefined
      ? (["redeems"] as const)
      : (["redeems", params] as const),
  apiKeys: ["api-keys"] as const,
  audit: (params?: unknown) =>
    params === undefined ? (["audit"] as const) : (["audit", params] as const),
  systemInfo: ["system-info"] as const,
  updateHistory: ["update-history"] as const,
} as const;
