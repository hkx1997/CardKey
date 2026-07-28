import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

import {
  DEFAULT_THEME,
  nextThemeId,
  normalizeThemeId,
  themeDef,
  THEME_STORAGE_KEY,
  THEMES,
  type ThemeId,
} from "./themes";
import {
  beginThemeTransition,
  endThemeTransition,
  forceEndThemeTransition,
  THEME_TRANSITION_FALLBACK_MS,
} from "./theme-transition";

interface ThemeContextValue {
  theme: ThemeId;
  isDark: boolean;
  themes: typeof THEMES;
  setTheme: (id: ThemeId) => void;
  cycleTheme: (event?: React.MouseEvent | MouseEvent) => void;
  toggleTheme: (event?: React.MouseEvent | MouseEvent) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

type VT = {
  finished: Promise<void>;
  ready: Promise<void>;
  skipTransition: () => void;
};

type StartViewTransition = (cb: () => void | Promise<void>) => VT;

function applyTheme(id: ThemeId) {
  const def = themeDef(id);
  const root = document.documentElement;
  root.dataset.theme = def.id;
  root.classList.toggle("dark", def.dark);
}

function readStored(): ThemeId {
  try {
    return normalizeThemeId(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

function persist(id: ThemeId) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

function commitTheme(id: ThemeId, setThemeState: (id: ThemeId) => void) {
  flushSync(() => {
    setThemeState(id);
  });
  applyTheme(id);
  persist(id);
}

function circleRadius(x: number, y: number) {
  return (
    Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    ) + 24
  );
}

/**
 * 圆形参数必须在 startViewTransition 之前写入。
 * 动画由 index.css 的 @keyframes 驱动（不与 WAAPI 抢同一 clip-path，避免时有时无）。
 */
function prepareCircleCssVars(x: number, y: number, toDark: boolean) {
  const root = document.documentElement;
  const r = circleRadius(x, y);
  root.style.setProperty("--theme-x", `${Math.round(x)}px`);
  root.style.setProperty("--theme-y", `${Math.round(y)}px`);
  root.style.setProperty("--theme-r", `${Math.round(r)}px`);
  root.dataset.themeCircle = toDark ? "shrink" : "expand";
  // 强制样式落盘，避免 startViewTransition 前变量未生效
  void root.offsetWidth;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    if (typeof document !== "undefined") {
      const id = readStored();
      applyTheme(id);
      return id;
    }
    return DEFAULT_THEME;
  });

  const themeRef = useRef(theme);
  themeRef.current = theme;
  const skipRef = useRef<(() => void) | null>(null);
  const genRef = useRef(0);
  /** 过渡进行中时跳过 useEffect 二次 apply，避免打断 VT */
  const transitioningRef = useRef(false);

  useEffect(() => {
    if (transitioningRef.current) return;
    applyTheme(theme);
    persist(theme);
  }, [theme]);

  useEffect(() => {
    return () => {
      skipRef.current?.();
      transitioningRef.current = false;
      forceEndThemeTransition();
    };
  }, []);

  const setTheme = useCallback((id: ThemeId) => {
    skipRef.current?.();
    genRef.current += 1;
    transitioningRef.current = false;
    forceEndThemeTransition();
    commitTheme(id, setThemeState);
  }, []);

  const cycleTheme = useCallback((event?: React.MouseEvent | MouseEvent) => {
    const current = themeRef.current;
    const target = nextThemeId(current);
    if (target === current) return;

    const toDark = themeDef(target).dark;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const x =
      event && Number.isFinite(event.clientX)
        ? event.clientX
        : window.innerWidth / 2;
    const y =
      event && Number.isFinite(event.clientY)
        ? event.clientY
        : window.innerHeight / 2;

    // 取消上一次
    if (skipRef.current) {
      skipRef.current();
      skipRef.current = null;
    }
    transitioningRef.current = false;
    forceEndThemeTransition();

    const doc = document as Document & {
      startViewTransition?: StartViewTransition;
    };
    const startVT = doc.startViewTransition?.bind(document);

    if (!startVT || reduced) {
      commitTheme(target, setThemeState);
      return;
    }

    if (!beginThemeTransition()) {
      commitTheme(target, setThemeState);
      return;
    }

    const gen = ++genRef.current;
    transitioningRef.current = true;
    // 必须在 startViewTransition 之前写好圆形参数（CSS 主路径）
    prepareCircleCssVars(x, y, toDark);

    let settled = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let transition: VT | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      skipRef.current = null;
      // 仅清理当前代，避免误清下一次
      if (genRef.current === gen) {
        transitioningRef.current = false;
        endThemeTransition();
      }
    };

    const abort = () => {
      try {
        transition?.skipTransition();
      } catch {
        /* ok */
      }
      finish();
    };
    skipRef.current = abort;
    fallbackTimer = setTimeout(abort, THEME_TRANSITION_FALLBACK_MS);

    try {
      transition = startVT(() => {
        commitTheme(target, setThemeState);
      });
    } catch {
      commitTheme(target, setThemeState);
      finish();
      return;
    }

    void (async () => {
      try {
        // 等待 ready：此时伪元素已创建，CSS keyframes 会挂上并延长 VT
        await transition!.ready;
      } catch {
        /* ready 失败：主题已提交，圆形可能跳过 */
      }
      try {
        await transition!.finished;
      } catch {
        /* ok */
      }
      // 等一帧再清变量，避免最后一帧闪切 / 残留 clip
      requestAnimationFrame(() => {
        if (genRef.current === gen) finish();
      });
    })();
  }, []);

  const value = useMemo(
    () => ({
      theme,
      isDark: themeDef(theme).dark,
      themes: THEMES,
      setTheme,
      cycleTheme,
      toggleTheme: cycleTheme,
    }),
    [theme, setTheme, cycleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
