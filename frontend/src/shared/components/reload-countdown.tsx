import { cn } from "@/shared/lib/cn";

type Props = {
  remaining: number;
  total: number;
  label?: string;
  className?: string;
};

/** 圆形 + 底条倒计时动画 */
export function ReloadCountdown({
  remaining,
  total,
  label,
  className,
}: Props) {
  const t = Math.max(1, total);
  const left = Math.max(0, Math.min(remaining, t));
  const progress = (t - left) / t;
  const size = 96;
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - progress);

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-5",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label={label || `${left} 秒后刷新`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          aria-hidden
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            className="stroke-secondary"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            className="stroke-primary transition-[stroke-dashoffset] duration-1000 ease-linear"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            key={left}
            className="font-mono text-3xl font-semibold tabular-nums tracking-tight text-foreground"
          >
            {left}
          </span>
          <span className="text-[10px] text-muted-foreground">秒后刷新</span>
        </div>
      </div>
      {label ? (
        <p className="max-w-[18rem] text-center text-xs text-muted-foreground leading-relaxed">
          {label}
        </p>
      ) : null}
      <div className="h-1.5 w-full max-w-[14rem] overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  );
}
