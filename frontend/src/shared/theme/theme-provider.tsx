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
  updateCallbackDone: Promise<void>;
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

/**
 * 在 startViewTransition 回调之前设置圆形参数，
 * 让 CSS @keyframes 挂在 ::view-transition-* 上由浏览器纳入过渡生命周期。
 * （比 ready 后再 WAAPI 更稳，避免 animation:none 导致过渡瞬间结束）
 */
function prepareCircleVars(
  x: number,
  y: number,
  toDark: boolean,
) {
  const root = document.documentElement;
  const endRadius =
    Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    ) + 16;
  root.style.setProperty("--theme-x", `${x}px`);
  root.style.setProperty("--theme-y", `${y}px`);
  root.style.setProperty("--theme-r", `${endRadius}px`);
  root.dataset.themeCircle = toDark ? "shrink" : "expand";
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

  // 仅同步 dataset；commitTheme 已写 DOM，这里避免无意义重算
  useEffect(() => {
    applyTheme(theme);
    persist(theme);
  }, [theme]);

  useEffect(() => {
    return () => {
      skipRef.current?.();
      forceEndThemeTransition();
    };
  }, []);

  const setTheme = useCallback((id: ThemeId) => {
    skipRef.current?.();
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

    // 中止上一次
    if (skipRef.current) {
      skipRef.current();
      skipRef.current = null;
    }
    forceEndThemeTransition();

    const doc = document as Document & {
      startViewTransition?: StartViewTransition;
    };
    const startVT = doc.startViewTransition?.bind(document);

    // 无 VT 或减少动态：直接切
    if (!startVT || reduced) {
      commitTheme(target, setThemeState);
      return;
    }

    if (!beginThemeTransition()) {
      commitTheme(target, setThemeState);
      return;
    }

    // 先写圆参数，再进 VT，CSS 动画能立刻挂上伪元素
    prepareCircleVars(x, y, toDark);

    let finished = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let transition: VT | undefined;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      skipRef.current = null;
      endThemeTransition();
    };

    const stop = () => {
      try {
        transition?.skipTransition();
      } catch {
        /* ok */
      }
      finish();
    };
    skipRef.current = stop;
    fallbackTimer = setTimeout(stop, THEME_TRANSITION_FALLBACK_MS);

    try {
      transition = startVT(() => {
        // 同步提交：新快照 = 完整界面 + 新主题
        commitTheme(target, setThemeState);
      });
    } catch {
      commitTheme(target, setThemeState);
      finish();
      return;
    }

    // 等浏览器完成过渡（CSS 圆形动画会被计入）
    void transition.finished
      .then(() => {
        finish();
      })
      .catch(() => {
        finish();
      });
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
