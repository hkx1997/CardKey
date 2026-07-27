import { FileUp, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { CodeBlock } from "@/shared/components/code-block";
import { FormActions } from "@/shared/components/form-actions";
import { FormField } from "@/shared/components/form-field";
import { PageContainer } from "@/shared/components/page-container";
import { PageHeader } from "@/shared/components/page-header";
import { useImportCards } from "@/shared/hooks/use-cards";
import { useCategoriesQuery } from "@/shared/hooks/use-categories";
import { CARD_TYPE_OPTIONS } from "@/shared/lib/card-content";
import { fieldErrors, importCardsSchema } from "@/shared/lib/schemas";

const IMPORT_TYPES = CARD_TYPE_OPTIONS.filter((o) => o.kind === "text");

export function ImportPage() {
  const catsQ = useCategoriesQuery();
  const m = useImportCards();

  const [categoryId, setCategoryId] = useState("");
  const [raw, setRaw] = useState(
    "权益内容 A\n权益内容 B\n{\"plan\":\"pro\",\"days\":30}",
  );
  const [type, setType] = useState<CardType>("text");
  const [batchName, setBatchName] = useState("批量导入");
  const [note, setNote] = useState("");
  const [resultCodes, setResultCodes] = useState<string[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const selectedCat = catsQ.data?.find((c) => c.id === categoryId);

  const previewLines = useMemo(
    () =>
      raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    [raw],
  );

  function onFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setRaw(String(reader.result ?? ""));
      toast.success(`已读取 ${file.name}`);
    };
    reader.readAsText(file);
  }

  function submit() {
    const parsed = fieldErrors(importCardsSchema, {
      categoryId,
      raw,
      type,
      batchName,
      note,
    });
    if (!parsed.ok) {
      setErrors(parsed.errors);
      toast.error(Object.values(parsed.errors)[0] ?? "请检查表单");
      return;
    }
    setErrors({});
    m.mutate(
      {
        ...parsed.data,
        note: parsed.data.note || undefined,
      },
      {
        onSuccess: (res) => setResultCodes(res.codes),
      },
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="批量导入"
        description="仅文本类（纯文本 / TXT / JSON / 账号）。图片、压缩包、PDF 等请用「新建卡密」单条上传或 API multipart"
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">导入内容</CardTitle>
            <CardDescription>每行一条 · 支持 TXT / CSV 上传</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField label="类别" required error={errors.categoryId}>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择类别" />
                </SelectTrigger>
                <SelectContent>
                  {(catsQ.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                        {c.codePrefix}-
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                label="类型"
                hint={IMPORT_TYPES.find((t) => t.id === type)?.hint}
              >
                <Select
                  value={type}
                  onValueChange={(v) => setType(v as CardType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IMPORT_TYPES.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="批次名称" required error={errors.batchName}>
                <Input
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                />
              </FormField>
            </div>
            <FormField label="备注">
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </FormField>
            <FormField label="内容（一行一条）" required error={errors.raw}>
              <div className="mb-1.5 flex justify-end">
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-primary hover:underline">
                  <FileUp className="size-3.5" />
                  上传文件
                  <input
                    type="file"
                    accept=".txt,.csv,.json,.jsonl"
                    className="hidden"
                    onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              <Textarea
                className="min-h-[220px] font-mono text-xs"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
              />
            </FormField>
            <FormActions>
              <Button
                disabled={m.isPending}
                onClick={submit}
              >
                {m.isPending ? (
                  <>
                    <Loader2 className="animate-spin" />
                    导入中…
                  </>
                ) : (
                  `导入 ${previewLines.length} 条`
                )}
              </Button>
            </FormActions>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">预览</CardTitle>
            <CardDescription>
              {selectedCat
                ? `编码前缀 ${selectedCat.codePrefix}- · ${previewLines.length} 条`
                : "请先选择类别"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="max-h-80 space-y-2 overflow-auto text-xs">
              {previewLines.slice(0, 20).map((line, i) => (
                <li
                  key={i}
                  className="rounded-md border border-border/80 bg-muted/30 px-2.5 py-2 font-mono"
                >
                  <span className="mr-2 text-muted-foreground">#{i + 1}</span>
                  {line.length > 80 ? `${line.slice(0, 80)}…` : line}
                </li>
              ))}
              {previewLines.length === 0 && (
                <li className="text-muted-foreground">暂无内容</li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>

      {resultCodes ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">生成的兑换编码</CardTitle>
            <CardDescription className="text-xs">
              请立即保存完整编码列表
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock
              lang="codes"
              code={resultCodes.join("\n")}
              heightClass="h-64"
            />
          </CardContent>
        </Card>
      ) : null}
    </PageContainer>
  );
}
