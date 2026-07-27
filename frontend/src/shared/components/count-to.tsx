import { useEffect, useRef, useState } from "react";

import { cn } from "@/shared/lib/cn";

type Props = {
  value: number;
  /** ms */
  duration?: number;
  decimals?: number;
  suffix?: string;
  className?: string;
  /** 加载中不动画 */
  disabled?: boolean;
};

/** 类似 vben CountTo：数字缓动递增 */
export function CountTo({
  value,
  duration = 900,
  decimals = 0,
  suffix,
  className,
  disabled,
}: Props) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const preferReduce =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (disabled || preferReduce) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const to = value;
    if (from === to) {
      setDisplay(to);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutExpo-ish
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const cur = from + (to - from) * eased;
      setDisplay(cur);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
        setDisplay(to);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, disabled, preferReduce]);

  const text =
    decimals > 0 ? display.toFixed(decimals) : Math.round(display).toLocaleString();

  return (
    <span className={cn("tabular-nums", className)}>
      {text}
      {suffix ? (
        <span className="ml-0.5 text-sm font-medium text-muted-foreground">
          {suffix}
        </span>
      ) : null}
    </span>
  );
}
