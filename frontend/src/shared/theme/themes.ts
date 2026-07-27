/**
 * 多主题循环。浅↔深交替，圆形动画用显式主题色。
 */
export type ThemeId =
  | "light"
  | "dark"
  | "zinc"
  | "slate"
  | "stone"
  | "midnight"
  | "olive";

export interface ThemeDef {
  id: ThemeId;
  label: string;
  dark: boolean;
  /** 圆形铺开用的实色（与 CSS --background 一致，避免 var 解析失败） */
  surface: string;
  /** 可选强调色，圆边更易感知 */
  accent: string;
}

export const THEMES: ThemeDef[] = [
  {
    id: "light",
    label: "白天",
    dark: false,
    surface: "oklch(0.995 0 0)",
    accent: "oklch(0.12 0 0)",
  },
  {
    id: "dark",
    label: "暗夜",
    dark: true,
    surface: "oklch(0.13 0 0)",
    accent: "oklch(0.96 0 0)",
  },
  {
    id: "zinc",
    label: "锌灰",
    dark: false,
    surface: "oklch(0.985 0.002 286)",
    accent: "oklch(0.28 0.03 286)",
  },
  {
    id: "slate",
    label: "岩板",
    dark: true,
    surface: "oklch(0.16 0.02 250)",
    accent: "oklch(0.78 0.06 230)",
  },
  {
    id: "stone",
    label: "暖石",
    dark: false,
    surface: "oklch(0.99 0.005 75)",
    accent: "oklch(0.35 0.04 50)",
  },
  {
    id: "midnight",
    label: "午夜",
    dark: true,
    surface: "oklch(0.14 0.03 270)",
    accent: "oklch(0.72 0.12 280)",
  },
  {
    id: "olive",
    label: "橄榄",
    dark: false,
    surface: "oklch(0.985 0.01 120)",
    accent: "oklch(0.4 0.08 140)",
  },
];

export const DEFAULT_THEME: ThemeId = "light";
export const THEME_STORAGE_KEY = "cardkey-theme";

export function isThemeId(v: string | null | undefined): v is ThemeId {
  return !!v && THEMES.some((t) => t.id === v);
}

export function normalizeThemeId(raw: string | null | undefined): ThemeId {
  if (isThemeId(raw)) return raw;
  return DEFAULT_THEME;
}

export function themeDef(id: ThemeId): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}

/** 下一主题：永远浅↔深 */
export function nextThemeId(current: ThemeId): ThemeId {
  const cur = themeDef(current);
  const start = THEMES.findIndex((t) => t.id === current);
  for (let step = 1; step <= THEMES.length; step++) {
    const cand = THEMES[(Math.max(0, start) + step) % THEMES.length]!;
    if (cand.dark !== cur.dark) return cand.id;
  }
  return THEMES.find((t) => t.dark !== cur.dark)?.id ?? THEMES[0]!.id;
}
