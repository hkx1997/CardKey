import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/shared/api/client";
import { cn } from "@/shared/lib/cn";
import { toastApiError } from "@/shared/lib/api-toast";

type Props = {
  label?: string;
  value: string;
  onChange: (url: string) => void;
  hint?: string;
  className?: string;
};

/** Logo / Favicon：支持本地上传或填写 URL */
export function ImageUploadField({
  value,
  onChange,
  hint,
  className,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.name.match(/\.svg$/i) || file.type === "image/svg+xml") {
      toast.error("出于安全考虑不支持 SVG，请使用 PNG / JPEG / WebP / ICO");
      return;
    }
    if (!file.type.startsWith("image/") && !file.name.match(/\.ico$/i)) {
      toast.error("请选择图片文件");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("图片不能超过 2MB");
      return;
    }
    setUploading(true);
    try {
      const res = await api.uploadImage(file);
      onChange(res.url);
      toast.success("上传成功");
    } catch (e) {
      // Mock / 失败时回退 data URL
      try {
        const dataUrl = await readAsDataURL(file);
        onChange(dataUrl);
        toast.message("已转为本地预览（Data URL）");
      } catch {
        toastApiError(e, "上传失败");
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-secondary/40">
          {value ? (
            <img
              src={value}
              alt=""
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <ImagePlus className="size-6 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://… 或上传后自动填入"
            className="font-mono text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ImagePlus className="size-3.5" />
              )}
              {uploading ? "上传中…" : "上传图片"}
            </Button>
            {value ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => onChange("")}
              >
                <Trash2 className="size-3.5" />
                清除
              </Button>
            ) : null}
          </div>
          {hint ? (
            <p className="text-[11px] text-muted-foreground">{hint}</p>
          ) : null}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/x-icon,.ico"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
    </div>
  );
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
