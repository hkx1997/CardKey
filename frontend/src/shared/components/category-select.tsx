import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Category, PublicCategory } from "@/entities/types";

type Item = Pick<Category, "slug" | "name" | "codePrefix"> | PublicCategory;

export function CategorySelect({
  items,
  value,
  onValueChange,
  placeholder = "选择类别",
  allowAll = false,
  allLabel = "全部类别",
  allValue = "__all__",
  disabled,
  className,
}: {
  items: Item[];
  value: string;
  onValueChange: (slug: string) => void;
  placeholder?: string;
  allowAll?: boolean;
  allLabel?: string;
  allValue?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={onValueChange}
      disabled={disabled || (!allowAll && items.length === 0)}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowAll ? (
          <SelectItem value={allValue}>{allLabel}</SelectItem>
        ) : null}
        {items.map((c) => (
          <SelectItem key={c.slug} value={c.slug}>
            {c.name}
            <span className="ml-2 font-mono text-[10px] text-muted-foreground">
              {c.codePrefix}-
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
