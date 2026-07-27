import { useState } from "react";

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
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const selectedCat = categories.find((c) => c.id === categoryId);
  const m = useCreateCard();

  function reset() {
    setCategoryId("");
    setContent("");
    setType("text");
    setNote("");
    setCreatedCode(null);
    setErrors({});
  }

  function submit() {
    const parsed = fieldErrors(cardCreateSchema, {
      categoryId,
      content,
      type,
      note,
    });
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    m.mutate(parsed.data, {
      onSuccess: (card) => setCreatedCode(card.code),
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建卡密</DialogTitle>
          <DialogDescription>
            必须选择类别；编码按该类别前缀自动生成
          </DialogDescription>
        </DialogHeader>
        {createdCode ? (
          <div className="space-y-3">
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
          <div className="space-y-3">
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
            <FormField label="类型">
              <Select
                value={type}
                onValueChange={(v) => setType(v as CardType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">text</SelectItem>
                  <SelectItem value="account">account</SelectItem>
                  <SelectItem value="json">json</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="卡密内容" required error={errors.content}>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="兑换成功后展示给用户的内容"
              />
            </FormField>
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
