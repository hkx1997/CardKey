import { FileUp } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CardType } from "@/entities/types";
import { FormActions } from "@/shared/components/form-actions";
import { FormField } from "@/shared/components/form-field";
import { SecretField } from "@/shared/components/secret-field";
import { useCreateCard } from "@/shared/hooks/use-cards";
import {
  CARD_TYPE_OPTIONS,
  MAX_CARD_FILE_BYTES,
  fileToBase64,
  formatBytes,
  isBinaryCardType,
} from "@/shared/lib/card-content";
import { cardCreateSchema, fieldErrors } from "@/shared/lib/schemas";

export function CreateCardDialog({
  open,
  onOpenChange,
  categories,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: { id: string; slug: string; name: string; codePrefix: string }[];
}) {
  const [categoryId, setCategoryId] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState<CardType>("text");
  const [note, setNote] = useState("");
  const [filename, setFilename] = useState("");
  const [mime, setMime] = useState("");
  const [encoding, setEncoding] = useState<"utf8" | "base64">("utf8");
  const [fileLabel, setFileLabel] = useState("");
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedCat = categories.find((c) => c.id === categoryId);
  const typeMeta = useMemo(
    () => CARD_TYPE_OPTIONS.find((o) => o.id === type),
    [type],
  );
  const binary = isBinaryCardType(type);
  const m = useCreateCard();

  function reset() {
    setCategoryId("");
    setContent("");
    setType("text");
    setNote("");
    setFilename("");
    setMime("");
    setEncoding("utf8");
    setFileLabel("");
    setCreatedCode(null);
    setErrors({});
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onPickFile(file: File | null) {
    if (!file) return;
    if (file.size > MAX_CARD_FILE_BYTES) {
      toast.error("文件不能超过 5MB");
      return;
    }
    try {
      const b64 = await fileToBase64(file);
      setContent(b64);
      setEncoding("base64");
      setFilename(file.name);
      setMime(file.type || "application/octet-stream");
      setFileLabel(`${file.name}（${formatBytes(file.size)}）`);
      // 按扩展名微调类型
      const ext = file.name.toLowerCase();
      if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/.test(ext)) {
        setType("image");
      } else if (file.type === "application/pdf" || ext.endsWith(".pdf")) {
        setType("pdf");
      } else if (
        file.type.includes("zip") ||
        /\.(zip|rar|7z|tar|gz|tgz)$/.test(ext)
      ) {
        setType("zip");
      } else if (!isBinaryCardType(type)) {
        setType("file");
      }
    } catch {
      toast.error("读取文件失败");
    }
  }

  function onTypeChange(v: CardType) {
    setType(v);
    if (!isBinaryCardType(v)) {
      setEncoding("utf8");
      if (fileLabel) {
        setContent("");
        setFileLabel("");
        setFilename("");
        setMime("");
      }
    } else {
      setEncoding("base64");
    }
  }

  function submit() {
    const parsed = fieldErrors(cardCreateSchema, {
      categoryId,
      content,
      type,
      note,
      contentEncoding: binary ? "base64" : encoding,
      filename: filename || undefined,
      mime: mime || undefined,
    });
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    m.mutate(
      {
        categoryId: parsed.data.categoryId,
        content: parsed.data.content,
        type: parsed.data.type,
        note: parsed.data.note,
        contentEncoding: binary ? "base64" : parsed.data.contentEncoding,
        filename: parsed.data.filename,
        mime: parsed.data.mime,
      },
      {
        onSuccess: (card) => setCreatedCode(card.code),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>新建卡密</DialogTitle>
          <DialogDescription>
            支持文本 / JSON / 图片 / 压缩包 / PDF / 任意文件（≤5MB），兑换端可下载
          </DialogDescription>
        </DialogHeader>
        {createdCode ? (
          <div className="dialog-body space-y-3">
            <p className="text-sm text-muted-foreground">兑换编码</p>
            <SecretField value={createdCode} monoClassName="text-sm" />
            <FormActions>
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
              >
                完成
              </Button>
            </FormActions>
          </div>
        ) : (
          <div className="dialog-body space-y-3">
            <FormField label="类别" required error={errors.categoryId}>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择类别" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                        {c.codePrefix}-
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCat ? (
                <p className="text-xs text-muted-foreground">
                  将生成 {selectedCat.codePrefix}-XXXX-…
                </p>
              ) : null}
            </FormField>
            <FormField label="内容类型">
              <Select
                value={type}
                onValueChange={(v) => onTypeChange(v as CardType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CARD_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {typeMeta ? (
                <p className="text-[11px] text-muted-foreground">
                  {typeMeta.hint}
                </p>
              ) : null}
            </FormField>

            {binary ? (
              <FormField label="上传文件" required error={errors.content}>
                <input
                  ref={fileRef}
                  type="file"
                  accept={typeMeta?.accept || "*/*"}
                  className="hidden"
                  onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => fileRef.current?.click()}
                >
                  <FileUp className="size-3.5" />
                  {fileLabel || "选择文件"}
                </Button>
              </FormField>
            ) : (
              <FormField label="卡密内容" required error={errors.content}>
                <Textarea
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    setEncoding("utf8");
                  }}
                  placeholder={
                    type === "json"
                      ? '{"user":"...","pass":"..."}'
                      : "兑换成功后展示给用户的内容"
                  }
                  className="min-h-[100px] font-mono text-xs"
                />
              </FormField>
            )}

            <FormField label="内部备注">
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </FormField>
            <FormActions>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button disabled={m.isPending} onClick={submit}>
                创建
              </Button>
            </FormActions>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
