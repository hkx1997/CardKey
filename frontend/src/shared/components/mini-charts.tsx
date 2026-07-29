import { cn } from "@/shared/lib/cn";

/** 轻量 SVG 图表（无额外依赖） */

export function AreaTrendChart({
  points,
  className,
  height = 180,
  onSelect,
}: {
  points: { label: string; count: number; date?: string }[];
  className?: string;
  height?: number;
  onSelect?: (index: number) => void;
}) {
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.count));
  const w = 600;
  const h = height;
  const padX = 8;
  const padY = 16;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;

  const coords = points.map((p, i) => {
    const x = padX + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = padY + innerH - (p.count / max) * innerH;
    return { x, y, ...p };
  });

  const line =
    coords.length > 0
      ? coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ")
      : "";
  const area =
    coords.length > 0
      ? `${line} L${coords[coords.length - 1]!.x},${padY + innerH} L${coords[0]!.x},${padY + innerH} Z`
      : "";

  const labelStep = Math.max(1, Math.ceil(n / 8));

  if (n === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center text-xs text-muted-foreground",
          className,
        )}
        style={{ height }}
      >
        暂无趋势数据
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-auto w-full"
        role="img"
        aria-label="趋势图"
      >
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--primary)"
              stopOpacity="0.35"
            />
            <stop
              offset="100%"
              stopColor="var(--primary)"
              stopOpacity="0.02"
            />
          </linearGradient>
        </defs>
        {/* 网格 */}
        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            x1={padX}
            x2={w - padX}
            y1={padY + innerH * (1 - g)}
            y2={padY + innerH * (1 - g)}
            stroke="currentColor"
            className="text-border"
            strokeOpacity={0.5}
            strokeDasharray="4 4"
          />
        ))}
        {area ? (
          <path d={area} fill="url(#trendFill)" />
        ) : null}
        {line ? (
          <path
            d={line}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={2.2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {coords.map((c, i) => (
          <g key={c.date ?? `${c.label}-${i}`}>
            <circle
              cx={c.x}
              cy={c.y}
              r={onSelect ? 5 : 3}
              className={cn(onSelect && "cursor-pointer")}
              fill="var(--primary)"
              onClick={() => onSelect?.(i)}
            >
              <title>
                {c.label}: {c.count}
              </title>
            </circle>
          </g>
        ))}
      </svg>
      <div className="mt-1 flex justify-between px-1 text-[10px] text-muted-foreground">
        {points.map((p, i) =>
          i % labelStep === 0 || i === n - 1 ? (
            <span key={`${p.label}-${i}`} className="tabular-nums">
              {p.label}
            </span>
          ) : (
            <span key={`${p.label}-${i}`} />
          ),
        )}
      </div>
    </div>
  );
}

export function DonutStatusChart({
  items,
  className,
  onSelect,
}: {
  items: { key: string; label: string; count: number; color: string }[];
  className?: string;
  onSelect?: (key: string) => void;
}) {
  const total = Math.max(0, items.reduce((s, i) => s + i.count, 0));
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className={cn("flex items-center gap-4", className)}>
      <svg viewBox="0 0 120 120" className="size-28 shrink-0">
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="var(--secondary)"
          strokeWidth="14"
        />
        {total === 0 ? null : (
          items.map((it) => {
            const len = (it.count / total) * c;
            const dash = `${len} ${c - len}`;
            const el = (
              <circle
                key={it.key}
                cx="60"
                cy="60"
                r={r}
                fill="none"
                stroke={it.color}
                strokeWidth="14"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                className={cn(onSelect && "cursor-pointer")}
                transform="rotate(-90 60 60)"
                onClick={() => onSelect?.(it.key)}
              >
                <title>
                  {it.label}: {it.count}
                </title>
              </circle>
            );
            offset += len;
            return el;
          })
        )}
        <text
          x="60"
          y="56"
          textAnchor="middle"
          className="fill-foreground text-[11px] font-semibold"
          style={{ fontSize: 13 }}
        >
          {total}
        </text>
        <text
          x="60"
          y="72"
          textAnchor="middle"
          className="fill-muted-foreground"
          style={{ fontSize: 9 }}
        >
          总量
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {items.map((it) => {
          const pct = total ? Math.round((it.count / total) * 100) : 0;
          return (
            <li key={it.key}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs",
                  onSelect && "hover:bg-secondary/50",
                )}
                onClick={() => onSelect?.(it.key)}
                disabled={!onSelect}
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: it.color }}
                />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {it.label}
                </span>
                <span className="tabular-nums font-medium">
                  {it.count}
                  <span className="ml-1 text-muted-foreground">({pct}%)</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function HBarCategoryChart({
  items,
  className,
  onSelect,
}: {
  items: { key: string; label: string; unused: number; total: number }[];
  className?: string;
  onSelect?: (key: string) => void;
}) {
  const max = Math.max(1, ...items.map((i) => i.total));
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">暂无类别数据</p>
    );
  }
  return (
    <div className={cn("space-y-2.5", className)}>
      {items.map((it) => {
        const used = Math.max(0, it.total - it.unused);
        const usedPct = (used / max) * 100;
        const unusedPct = (it.unused / max) * 100;
        return (
          <button
            key={it.key}
            type="button"
            className={cn(
              "block w-full text-left",
              onSelect && "rounded-md hover:bg-secondary/40",
            )}
            onClick={() => onSelect?.(it.key)}
            disabled={!onSelect}
          >
            <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate font-medium">{it.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                未用 {it.unused} / {it.total}
              </span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-foreground/35"
                style={{ width: `${usedPct}%` }}
                title={`已兑 ${used}`}
              />
              <div
                className="h-full bg-emerald-500/80"
                style={{ width: `${unusedPct}%` }}
                title={`未用 ${it.unused}`}
              />
            </div>
          </button>
        );
      })}
      <div className="flex gap-3 pt-1 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-sm bg-foreground/35" /> 已兑
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-sm bg-emerald-500/80" /> 未用
        </span>
      </div>
    </div>
  );
}

export function RangePills<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
            value === o.id
              ? "bg-primary text-primary-foreground shadow-sm"
              : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
