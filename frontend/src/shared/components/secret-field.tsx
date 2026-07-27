import type { ReactNode } from "react";

import { CopyIconButton } from "@/shared/components/copy-button";
import { cn } from "@/shared/lib/cn";

/**
 * 密钥/密文展示框：文本在左，图标操作内嵌右侧。
 * 用于固定密钥、自定义密钥、弹窗明文等。
 */
export function SecretField({
  value,
  display,
  actions,
  className,
  monoClassName,
  showCopy = true,
}: {
  /** 复制用的完整值 */
  value: string;
  /** 展示文本（可掩码） */
  display?: string;
  /** 额外图标操作（显示/隐藏、轮换等），放在复制左侧 */
  actions?: ReactNode;
  className?: string;
  monoClassName?: string;
  showCopy?: boolean;
}) {
  const text = display ?? value ?? "—";
  return (
    <div
      className={cn(
        "flex min-w-0 max-w-full items-stretch gap-0.5 overflow-hidden rounded-xl border border-border bg-secondary/40 pl-3 pr-1",
        className,
      )}
    >
      <code
        className={cn(
          "min-w-0 flex-1 self-center overflow-x-hidden break-all py-2.5 font-mono text-xs leading-relaxed sm:text-[13px]",
          monoClassName,
        )}
      >
        {text || "—"}
      </code>
      <div className="flex shrink-0 items-center gap-0.5 self-center py-0.5">
        {actions}
        {showCopy ? (
          <CopyIconButton value={value} disabled={!value} />
        ) : null}
      </div>
    </div>
  );
}
