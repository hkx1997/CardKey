import type { CardType, RedeemResult } from "@/entities/types";

export type CardTypeMeta = {
  id: CardType;
  label: string;
  kind: "text" | "file";
  accept?: string;
  hint: string;
};

/** 卡密内容类型（管理端选择 + 展示） */
export const CARD_TYPE_OPTIONS: CardTypeMeta[] = [
  { id: "text", label: "纯文本", kind: "text", hint: "兑换后直接展示文本" },
  { id: "txt", label: "TXT", kind: "text", hint: "文本文件，可下载 .txt" },
  { id: "json", label: "JSON", kind: "text", hint: "须为合法 JSON" },
  { id: "account", label: "账号信息", kind: "text", hint: "账号/密码等多行文本" },
  {
    id: "image",
    label: "图片",
    kind: "file",
    accept: "image/png,image/jpeg,image/gif,image/webp,image/bmp",
    hint: "PNG / JPEG / GIF / WebP 等，≤5MB",
  },
  {
    id: "zip",
    label: "压缩包",
    kind: "file",
    accept: ".zip,.rar,.7z,.tar,.gz,.tgz,application/zip",
    hint: "ZIP 等压缩包，≤5MB",
  },
  {
    id: "pdf",
    label: "PDF",
    kind: "file",
    accept: "application/pdf,.pdf",
    hint: "PDF 文档，≤5MB",
  },
  {
    id: "file",
    label: "任意文件",
    kind: "file",
    accept: "*/*",
    hint: "任意格式单文件，≤5MB",
  },
];

export function isBinaryCardType(t: CardType | string | undefined): boolean {
  return t === "image" || t === "zip" || t === "pdf" || t === "file";
}

export function cardTypeLabel(t: CardType | string | undefined): string {
  return CARD_TYPE_OPTIONS.find((o) => o.id === t)?.label ?? t ?? "—";
}

/** 将兑换/详情内容转为 Blob */
export function contentToBlob(opts: {
  content: string;
  contentEncoding?: string;
  mime?: string;
  type?: CardType | string;
}): Blob {
  const mime =
    opts.mime ||
    (opts.type === "json"
      ? "application/json"
      : opts.type === "pdf"
        ? "application/pdf"
        : opts.type === "zip"
          ? "application/zip"
          : isBinaryCardType(opts.type)
            ? "application/octet-stream"
            : "text/plain;charset=utf-8");

  if (opts.contentEncoding === "base64" || isBinaryCardType(opts.type)) {
    const bin = base64ToUint8Array(opts.content);
    // BlobPart 兼容：拷贝到全新 ArrayBuffer，避免 SharedArrayBuffer 类型问题
    const ab = new ArrayBuffer(bin.byteLength);
    new Uint8Array(ab).set(bin);
    return new Blob([ab], { type: mime });
  }
  return new Blob([opts.content], { type: mime });
}

export function base64ToUint8Array(b64: string): Uint8Array {
  let s = b64.trim();
  const marker = ";base64,";
  const i = s.indexOf(marker);
  if (i >= 0) s = s.slice(i + marker.length);
  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let j = 0; j < binary.length; j++) out[j] = binary.charCodeAt(j);
  return out;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadRedeemContent(r: RedeemResult) {
  const blob = contentToBlob({
    content: r.content,
    contentEncoding: r.contentEncoding,
    mime: r.mime,
    type: r.type,
  });
  const name =
    r.filename ||
    (r.type === "json"
      ? `${r.code}.json`
      : isBinaryCardType(r.type)
        ? `${r.code}.bin`
        : `${r.code}.txt`);
  downloadBlob(blob, name);
}

export function formatBytes(n: number | undefined | null): string {
  if (n == null || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** 管理端文件 → base64（不含 data: 前缀） */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export const MAX_CARD_FILE_BYTES = 5 * 1024 * 1024;
