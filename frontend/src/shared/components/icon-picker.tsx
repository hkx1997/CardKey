import { ImagePlus } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { CategoryIcon } from "@/entities/types";
import {
  CategoryIconView,
  LUCIDE_ICON_OPTIONS,
} from "@/shared/lib/category-icons";
import { cn } from "@/shared/lib/cn";

const MAX_IMAGE_BYTES = 200 * 1024;

export function IconPicker({
  value,
  onChange,
}: {
  value: CategoryIcon;
  onChange: (icon: CategoryIcon) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  function onFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("图片需小于 200KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      onChange({ kind: "image", value: String(reader.result) });
      toast.success("图标已更新");
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="min-w-0 max-w-full space-y-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-secondary/70">
          <CategoryIconView icon={value} size={22} />
        </div>
        <div className="min-w-0 truncate text-[11px] text-muted-foreground">
          {value.kind === "image" ? "自定义图片" : `图标库 · ${value.value}`}
        </div>
      </div>

      <div className="min-w-0 space-y-1.5">
        <Label className="text-xs">图标库</Label>
        <div className="grid min-w-0 grid-cols-6 gap-1.5">
          {LUCIDE_ICON_OPTIONS.map((name) => {
            const active = value.kind === "lucide" && value.value === name;
            return (
              <button
                key={name}
                type="button"
                title={name}
                onClick={() => onChange({ kind: "lucide", value: name })}
                className={cn(
                  "interactive-press flex size-9 items-center justify-center rounded-md border border-transparent bg-secondary/50 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                  active && "border-border bg-background text-foreground shadow-sm",
                )}
              >
                <CategoryIconView
                  icon={{ kind: "lucide", value: name }}
                  size={16}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">上传图片</Label>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="interactive-press"
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus />
          选择图片（≤200KB）
        </Button>
      </div>
    </div>
  );
}
