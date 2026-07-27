import { Download, FileArchive, FileText, ImageIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { CardType } from "@/entities/types";
import { CopyIconButton } from "@/shared/components/copy-button";
import {
  contentToBlob,
  downloadBlob,
  formatBytes,
  isBinaryCardType,
} from "@/shared/lib/card-content";
import { cn } from "@/shared/lib/cn";

type Props = {
  type: CardType | string;
  content: string;
  contentEncoding?: string;
  filename?: string;
  mime?: string;
  size?: number;
  className?: string;
  /** 紧凑模式（兑换页） */
  compact?: boolean;
};

export function CardContentView({
  type,
  content,
  contentEncoding,
  filename,
  mime,
  size,
  className,
  compact,
}: Props) {
  const binary =
    contentEncoding === "base64" || isBinaryCardType(type);

  const textPreview = useMemo(() => {
    if (binary) return "";
    if (type === "json") {
      try {
        return JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        return content;
      }
    }
    return content;
  }, [binary, content, type]);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  useEffect(() => {
    if (type !== "image" || !binary || !content) {
      setImageUrl(null);
      return;
    }
    let url: string | null = null;
    try {
      const blob = contentToBlob({
        content,
        contentEncoding: "base64",
        mime: mime || "image/*",
        type: "image",
      });
      url = URL.createObjectURL(blob);
      setImageUrl(url);
    } catch {
      setImageUrl(null);
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [type, binary, content, mime]);

  function onDownload() {
    const blob = contentToBlob({
      content,
      contentEncoding: binary ? "base64" : contentEncoding || "utf8",
      mime,
      type,
    });
    const name =
      filename ||
      (type === "json"
        ? "content.json"
        : type === "pdf"
          ? "content.pdf"
          : type === "zip"
            ? "content.zip"
            : binary
              ? "download.bin"
              : "content.txt");
    downloadBlob(blob, name);
  }

  const icon =
    type === "image" ? (
      <ImageIcon className="size-4" />
    ) : type === "zip" ? (
      <FileArchive className="size-4" />
    ) : (
      <FileText className="size-4" />
    );

  if (binary) {
    return (
      <div
        className={cn(
          "min-w-0 space-y-2 rounded-xl border border-border/60 bg-secondary/30 p-3",
          className,
        )}
      >
        <div className="flex items-start gap-2">
          <div className="mt-0.5 text-muted-foreground">{icon}</div>
          <div className="min-w-0 flex-1 text-xs">
            <p className="truncate font-medium text-foreground">
              {filename || "附件"}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {mime || type}
              {size != null && size > 0 ? ` · ${formatBytes(size)}` : ""}
            </p>
          </div>
          <Button type="button" size="sm" onClick={onDownload}>
            <Download className="size-3.5" />
            下载
          </Button>
        </div>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={filename || "预览"}
            className="mx-auto max-h-48 max-w-full rounded-lg border border-border/50 object-contain"
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-w-0 items-stretch gap-0.5 rounded-xl border border-border/60 bg-secondary/30 pl-3 pr-1",
        className,
      )}
    >
      <pre
        className={cn(
          "min-w-0 flex-1 overflow-auto py-3 pr-2 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap sm:text-[13px]",
          compact ? "max-h-52" : "max-h-64",
        )}
      >
        {textPreview || "（空）"}
      </pre>
      <div className="flex shrink-0 flex-col items-center gap-0.5 pt-1">
        <CopyIconButton value={content} />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          title="下载为文件"
          onClick={onDownload}
        >
          <Download className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
