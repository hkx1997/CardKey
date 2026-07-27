import { useId } from "react";

import { useTheme } from "@/shared/theme/theme-provider";
import { themeDef } from "@/shared/theme/themes";
import { cn } from "@/shared/lib/cn";

/**
 * 单按钮循环多主题 — 圆形 View Transition + 日月图标
 * 每次点击切换下一主题（light → zinc → … → midnight → light）
 */
export function ThemeToggleButton({ className }: { className?: string }) {
  const { isDark, cycleTheme, theme, themes } = useTheme();
  const maskId = useId().replace(/:/g, "");
  const modeClass = isDark ? "light" : "dark";
  const label = themeDef(theme).label;
  const next = themes[(themes.findIndex((t) => t.id === theme) + 1) % themes.length];

  return (
    <button
      type="button"
      title={`${label} → ${next?.label ?? ""}`}
      aria-label={`切换主题，当前 ${label}`}
      aria-live="polite"
      className={cn(
        "theme-toggle is-" + modeClass,
        "inline-flex size-8 cursor-pointer items-center justify-center rounded-full border-none bg-transparent p-[7px] text-muted-foreground transition-colors hover:bg-secondary/55 hover:text-foreground",
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        cycleTheme(e);
      }}
    >
      <svg
        aria-hidden="true"
        height="24"
        width="24"
        viewBox="0 0 24 24"
        className="overflow-visible"
      >
        <mask id={maskId} className="theme-toggle__moon">
          <rect fill="white" height="100%" width="100%" x="0" y="0" />
          <circle
            className="theme-toggle__moon-cut"
            cx="40"
            cy="8"
            fill="black"
            r="11"
          />
        </mask>
        <circle
          className="theme-toggle__sun"
          cx="12"
          cy="12"
          r="11"
          mask={`url(#${maskId})`}
        />
        <g className="theme-toggle__sun-beams">
          <line x1="12" x2="12" y1="1" y2="3" />
          <line x1="12" x2="12" y1="21" y2="23" />
          <line x1="4.22" x2="5.64" y1="4.22" y2="5.64" />
          <line x1="18.36" x2="19.78" y1="18.36" y2="19.78" />
          <line x1="1" x2="3" y1="12" y2="12" />
          <line x1="21" x2="23" y1="12" y2="12" />
          <line x1="4.22" x2="5.64" y1="19.78" y2="18.36" />
          <line x1="18.36" x2="19.78" y1="5.64" y2="4.22" />
        </g>
      </svg>
    </button>
  );
}
