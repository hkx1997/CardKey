import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { Category, CategoryIcon } from "@/entities/types";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  DataTable,
  type DataTableColumn,
} from "@/shared/components/data-table";
import { FormActions } from "@/shared/components/form-actions";
import { FormField } from "@/shared/components/form-field";
import { IconPicker } from "@/shared/components/icon-picker";
import { PageContainer } from "@/shared/components/page-container";
import { PageHeader } from "@/shared/components/page-header";
import { RichTextEditor } from "@/shared/components/rich-text-editor";
import {
  useCategoriesQuery,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from "@/shared/hooks/use-categories";
import {
  categoryCreateSchema,
  categoryUpdateSchema,
  fieldErrors,
} from "@/shared/lib/schemas";
import { CategoryIconView } from "@/shared/lib/category-icons";
import { formatDateTime } from "@/shared/lib/format";
import { isEmptyHtml } from "@/shared/lib/sanitize-html";

/** 有兑换记录则不可删，仅可停用 */
function canDeleteCategory(c: Category) {
  return (c.usedCount ?? 0) === 0;
}

export function CategoriesPage() {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [codePrefix, setCodePrefix] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<CategoryIcon>({
    kind: "lucide",
    value: "ticket",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const listQ = useCategoriesQuery();
  const createM = useCreateCategory();
  const updateM = useUpdateCategory();
  const deleteM = useDeleteCategory();

  function closeCreate() {
    setOpen(false);
    setName("");
    setSlug("");
    setCodePrefix("");
    setDescription("");
    setIcon({ kind: "lucide", value: "ticket" });
    setErrors({});
  }

  function openEdit(c: Category) {
    setEdit(c);
    setName(c.name);
    setDescription(c.description ?? "");
    setIcon(
      c.icon ?? {
        kind: "lucide",
        value: "ticket",
      },
    );
    setErrors({});
  }

  function submitCreate() {
    const parsed = fieldErrors(categoryCreateSchema, {
      name,
      slug,
      codePrefix,
      description,
    });
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    createM.mutate(
      { ...parsed.data, description: parsed.data.description ?? "", icon },
      { onSuccess: () => closeCreate() },
    );
  }

  function submitEdit() {
    if (!edit) return;
    const parsed = fieldErrors(categoryUpdateSchema, { name, description });
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    updateM.mutate(
      {
        id: edit.id,
        name: parsed.data.name,
        description: parsed.data.description ?? "",
        icon,
      },
      { onSuccess: () => setEdit(null) },
    );
  }

  async function handleDeleteOrDisable(c: Category) {
    if (canDeleteCategory(c)) {
      const stock = c.cardCount ?? 0;
      const ok = await confirm({
        title: `删除类别「${c.name}」`,
        description:
          stock > 0
            ? `将同时删除该类别下 ${stock} 条未使用/已禁用卡密与相关批次。此操作不可恢复。`
            : "将永久删除该类别。此操作不可恢复。",
        confirmLabel: "删除",
        destructive: true,
      });
      if (!ok) return;
      deleteM.mutate(c.id);
      return;
    }
    if (!c.enabled) {
      toast.message("该类别已有兑换记录且已停用，无法删除");
      return;
    }
    const ok = await confirm({
      title: `停用类别「${c.name}」`,
      description:
        "该类别已有兑换记录，不能删除，只能停用。停用后兑换端不可见。",
      confirmLabel: "停用",
      destructive: true,
    });
    if (!ok) return;
    updateM.mutate({ id: c.id, enabled: false });
  }

  const columns = useMemo<DataTableColumn<Category>[]>(
    () => [
      {
        id: "name",
        header: "类别",
        cell: (c) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary/60">
              <CategoryIconView icon={c.icon} size={16} />
            </div>
            <div className="min-w-0">
              <div className="truncate font-medium">{c.name}</div>
              {!isEmptyHtml(c.description) ? (
                <div className="line-clamp-1 text-[11px] text-muted-foreground">
                  {c.description.replace(/<[^>]+>/g, "").slice(0, 40)}
                </div>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        id: "slug",
        header: "Slug",
        showFrom: "md",
        cellClassName: "font-mono text-[11px]",
        cell: (c) => c.slug,
      },
      {
        id: "prefix",
        header: "前缀",
        showFrom: "sm",
        cell: (c) => (
          <Badge variant="outline" className="font-mono">
            {c.codePrefix}-
          </Badge>
        ),
      },
      {
        id: "stock",
        header: "库存",
        cellClassName: "tabular-nums text-xs whitespace-nowrap",
        cell: (c) => (
          <>
            <span className="text-emerald-600 dark:text-emerald-400">
              {c.unusedCount ?? 0}
            </span>
            <span className="text-muted-foreground"> / {c.cardCount ?? 0}</span>
            {(c.usedCount ?? 0) > 0 ? (
              <span className="ml-1 text-muted-foreground">
                · 已兑 {c.usedCount}
              </span>
            ) : null}
          </>
        ),
      },
      {
        id: "enabled",
        header: "启用",
        cell: (c) => (
          <Switch
            checked={c.enabled}
            onCheckedChange={(enabled) =>
              updateM.mutate({ id: c.id, enabled })
            }
            aria-label={`${c.name} 启用开关`}
          />
        ),
      },
      {
        id: "created",
        header: "创建",
        showFrom: "lg",
        cellClassName: "text-[11px] text-muted-foreground whitespace-nowrap",
        cell: (c) => formatDateTime(c.createdAt),
      },
      {
        id: "actions",
        header: "操作",
        align: "right",
        cell: (c) => (
          <div className="flex items-center justify-end gap-0.5">
            <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>
              <Pencil />
              <span className="hidden sm:inline">编辑</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={deleteM.isPending || updateM.isPending}
              onClick={() => void handleDeleteOrDisable(c)}
              title={
                canDeleteCategory(c)
                  ? "删除类别"
                  : "有兑换记录，仅可停用"
              }
            >
              <Trash2 />
              <span className="hidden sm:inline">
                {canDeleteCategory(c) ? "删除" : "停用"}
              </span>
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updateM, deleteM],
  );

  return (
    <PageContainer className="fade-in">
      <PageHeader
        title="类别管理"
        description="无兑换记录可删；有记录仅可停用 · 前缀创建后不可改"
        actions={
          <Button className="interactive-press" onClick={() => setOpen(true)}>
            <Plus />
            新建类别
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">全部类别</CardTitle>
          <CardDescription className="text-xs">
            停用后兑换端不可见；有兑换数据的类别只能停用不能删除
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            rows={listQ.data}
            rowKey={(c) => c.id}
            loading={listQ.isLoading}
            minWidth={560}
            empty="暂无类别，点击右上角新建"
            mobileCard={(c) => (
              <div className="flex items-center gap-3 rounded-xl border border-border/70 p-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary/60">
                  <CategoryIconView icon={c.icon} size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="mt-0.5 tabular-nums text-[11px] text-muted-foreground">
                    库存 {c.unusedCount ?? 0} / {c.cardCount ?? 0}
                    {(c.usedCount ?? 0) > 0 ? ` · 已兑 ${c.usedCount}` : ""}
                    <span className="ml-1.5 font-mono">{c.codePrefix}-</span>
                  </p>
                </div>
                <Switch
                  checked={c.enabled}
                  onCheckedChange={(enabled) =>
                    updateM.mutate({ id: c.id, enabled })
                  }
                  aria-label={`${c.name} 启用`}
                />
                <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => void handleDeleteOrDisable(c)}
                >
                  <Trash2 />
                </Button>
              </div>
            )}
          />
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) closeCreate();
          else setOpen(true);
        }}
      >
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>新建类别</DialogTitle>
            <DialogDescription>
              前缀决定编码形态；图标展示于兑换 Tab
            </DialogDescription>
          </DialogHeader>
          <div className="dialog-body space-y-3">
            <FormField label="名称" required error={errors.name}>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="会员卡"
              />
            </FormField>
            <FormField label="Slug" required error={errors.slug}>
              <Input
                value={slug}
                onChange={(e) =>
                  setSlug(
                    e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                  )
                }
                placeholder="vip"
                className="font-mono"
              />
            </FormField>
            <FormField label="编码前缀" required error={errors.codePrefix}>
              <Input
                value={codePrefix}
                onChange={(e) =>
                  setCodePrefix(
                    e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                  )
                }
                placeholder="VIP"
                className="font-mono"
                maxLength={8}
              />
            </FormField>
            <FormField label="描述（富文本）">
              <RichTextEditor
                key="create-desc"
                value={description}
                onChange={setDescription}
                placeholder="展示在兑换端对应 Tab 下方"
              />
            </FormField>
            <IconPicker value={icon} onChange={setIcon} />
          </div>
          <FormActions className="mt-2">
            <Button variant="outline" onClick={closeCreate}>
              取消
            </Button>
            <Button
              className="interactive-press"
              disabled={createM.isPending}
              onClick={submitCreate}
            >
              创建
            </Button>
          </FormActions>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!edit}
        onOpenChange={(v) => {
          if (!v) {
            setEdit(null);
            setDescription("");
            setErrors({});
          }
        }}
      >
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>编辑类别</DialogTitle>
            <DialogDescription className="break-all font-mono text-xs">
              {edit?.slug} · 前缀 {edit?.codePrefix}-（不可改）
            </DialogDescription>
          </DialogHeader>
          <div className="dialog-body space-y-3">
            <FormField label="名称" required error={errors.name}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="描述（富文本）">
              <RichTextEditor
                key={edit?.id ?? "edit-desc"}
                value={description}
                onChange={setDescription}
                placeholder="展示在兑换端对应 Tab 下方"
              />
            </FormField>
            <IconPicker value={icon} onChange={setIcon} />
          </div>
          <FormActions className="mt-2">
            <Button variant="outline" onClick={() => setEdit(null)}>
              取消
            </Button>
            <Button
              className="interactive-press"
              disabled={updateM.isPending}
              onClick={submitEdit}
            >
              保存
            </Button>
          </FormActions>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
