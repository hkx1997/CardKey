import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/shared/lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
      "data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/** 弹窗宽度档位：固定 w-[min(X,100vw-2rem)]，避免仅改 max-w 无效 */
const DIALOG_SIZE_CLASS = {
  sm: "w-[min(24rem,calc(100vw-2rem))]",
  md: "w-[min(28rem,calc(100vw-2rem))]",
  lg: "w-[min(36rem,calc(100vw-2rem))]",
  xl: "w-[min(42rem,calc(100vw-2rem))]",
  "2xl": "w-[min(48rem,calc(100vw-2rem))]",
} as const;

export type DialogContentSize = keyof typeof DIALOG_SIZE_CLASS;

type DialogContentProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> & {
  /**
   * 宽度档位。默认 md(28rem)。
   * 富文本 / 表单较满时用 lg 或 xl。
   * 也可继续用 className 覆盖 w-*。
   */
  size?: DialogContentSize;
};

/**
 * 弹窗内容壳：严格限制在视口内，禁止被长串/富文本/表格撑出横向滚动。
 * 用 size 控制宽度；className 可再覆盖。
 */
export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, size = "md", ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "dialog-content fixed left-1/2 top-1/2 z-50 box-border flex max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col",
        DIALOG_SIZE_CLASS[size] ?? DIALOG_SIZE_CLASS.md,
        "max-h-[min(90dvh,900px)] min-h-0 min-w-0 gap-4 overflow-x-hidden overflow-y-auto overscroll-contain",
        "rounded-xl border border-border bg-card p-4 shadow-xl sm:p-6",
        // 直接子级收缩，避免 grid/flex 子项 min-content 撑宽
        "[&>*]:min-w-0 [&>*]:max-w-full",
        "data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 z-10 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground opacity-80 transition-[opacity,background-color,transform,color] duration-150 hover:bg-secondary hover:text-foreground hover:opacity-100 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <X className="size-4" />
        <span className="sr-only">关闭</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

export function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-w-0 max-w-full flex-col gap-1.5 pr-8 text-center sm:text-left",
        className,
      )}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 max-w-full flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

export const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "min-w-0 max-w-full break-words text-lg font-semibold leading-none",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn(
      "min-w-0 max-w-full break-words text-sm text-muted-foreground",
      className,
    )}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;
