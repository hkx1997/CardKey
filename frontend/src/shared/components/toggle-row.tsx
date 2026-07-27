import { Switch } from "@/components/ui/switch";
import { cn } from "@/shared/lib/cn";

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  className,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-lg border border-border/60 px-3 py-2.5",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-xs font-medium">{label}</div>
        {description ? (
          <div className="text-[11px] text-muted-foreground">{description}</div>
        ) : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
