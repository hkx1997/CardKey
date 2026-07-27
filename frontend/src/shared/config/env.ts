export type ApiMode = "mock" | "http";

const raw = (import.meta.env.VITE_API_MODE as string | undefined) ?? "mock";

export const env = {
  apiMode: (raw === "http" ? "http" : "mock") as ApiMode,
  isMock: raw !== "http",
} as const;
