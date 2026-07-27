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
  isThemeTransitionRunning,
  THEME_TRANSITION_FALLBACK_MS,
  THEME_VIEW_TRANSITION_MS,
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
  void root.offsetWidth;
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
 * 整页内容可见的圆形切换（View Transition 快照 = 真实界面 + 主题色）
 * - 切到浅色：新界面从点击点圆形展开（黑切白）
 * - 切到深色：旧界面向点击点圆形收缩（白切黑）
 */
function runContentCircle(
  x: number,
  y: number,
  toDark: boolean,
  duration: number,
): Animation {
  const endRadius =
    Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    ) + 8;
  const clip = [
    `circle(0px at ${x}px ${y}px)`,
    `circle(${endRadius}px at ${x}px ${y}px)`,
  ];
  return document.documentElement.animate(
    {
      clipPath: toDark ? [...clip].reverse() : clip,
    },
    {
      duration,
      easing: "ease-in",
      pseudoElement: toDark
        ? "::view-transition-old(root)"
        : "::view-transition-new(root)",
    },
  );
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

  useEffect(() => {
    applyTheme(theme);
    persist(theme);
  }, [theme]);

  useEffect(() => {
    return () => {
      skipRef.current?.();
      endThemeTransition();
    };
  }, []);

  const setTheme = useCallback((id: ThemeId) => {
    skipRef.current?.();
    endThemeTransition();
    commitTheme(id, setThemeState);
  }, []);

  const cycleTheme = useCallback((event?: React.MouseEvent | MouseEvent) => {
    const current = themeRef.current;
    const target = nextThemeId(current);
    if (target === current) return;

    const toDark = themeDef(target).dark;
    const doc = document as Document & {
      startViewTransition?: StartViewTransition;
    };
    const startVT = doc.startViewTransition?.bind(document);
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
    if (isThemeTransitionRunning()) {
      endThemeTransition();
    }

    // 无 VT 或减少动态：直接切（界面仍完整）
    if (!startVT || reduced) {
      commitTheme(target, setThemeState);
      return;
    }

    if (!beginThemeTransition()) {
      commitTheme(target, setThemeState);
      return;
    }

    // 控制新旧层叠顺序，保证圆扩/圆收时都能看到界面内容
    document.documentElement.dataset.themeCircle = toDark
      ? "shrink"
      : "expand";

    let finished = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let transition: VT;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      skipRef.current = null;
      delete document.documentElement.dataset.themeCircle;
      endThemeTransition();
    };

    try {
      transition = startVT(() => {
        // 同步刷 DOM：新快照 = 完整界面 + 新主题色（内容可见）
        commitTheme(target, setThemeState);
      });
    } catch {
      commitTheme(target, setThemeState);
      finish();
      return;
    }

    const stop = () => {
      try {
        transition.skipTransition();
      } catch {
        /* ok */
      }
      finish();
    };
    skipRef.current = stop;
    fallbackTimer = setTimeout(stop, THEME_TRANSITION_FALLBACK_MS);

    void transition.ready
      .then(() => {
        if (finished) return;
        try {
          const anim = runContentCircle(
            x,
            y,
            toDark,
            THEME_VIEW_TRANSITION_MS,
          );
          void anim.finished.then(stop).catch(stop);
        } catch {
          stop();
        }
      })
      .catch(() => {
        // ready 失败主题已提交
        finish();
      });

    void transition.finished.catch(finish);
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
