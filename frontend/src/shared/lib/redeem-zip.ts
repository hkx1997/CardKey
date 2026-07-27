import JSZip from "jszip";

import type { RedeemResult } from "@/entities/types";
import {
  base64ToUint8Array,
  isBinaryCardType,
} from "@/shared/lib/card-content";

export type BatchRedeemItem = {
  /** 输入编码 */
  code: string;
  ok: boolean;
  result?: RedeemResult;
  error?: string;
};

/** 文件名安全：去掉路径与非法字符 */
export function safeFileName(code: string, index: number, ext = ".txt"): string {
  const base = code
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
  const name = base || `code_${index + 1}`;
  const e = ext.startsWith(".") ? ext : `.${ext}`;
  return `${String(index + 1).padStart(3, "0")}_${name}${e}`;
}

function extFromResult(r: RedeemResult): string {
  if (r.filename && r.filename.includes(".")) {
    return r.filename.slice(r.filename.lastIndexOf("."));
  }
  switch (r.type) {
    case "json":
      return ".json";
    case "pdf":
      return ".pdf";
    case "zip":
      return ".zip";
    case "image":
      if (r.mime?.includes("png")) return ".png";
      if (r.mime?.includes("jpeg") || r.mime?.includes("jpg")) return ".jpg";
      if (r.mime?.includes("gif")) return ".gif";
      if (r.mime?.includes("webp")) return ".webp";
      return ".img";
    case "txt":
    case "text":
    case "account":
      return ".txt";
    default:
      return isBinaryCardType(r.type) ? ".bin" : ".txt";
  }
}

/** 单条兑换结果 → 文本说明（非二进制） */
export function formatRedeemFile(item: BatchRedeemItem): string {
  const lines: string[] = [
    "CardKey 兑换结果",
    "================",
    `code: ${item.code}`,
  ];

  if (item.ok && item.result) {
    lines.push(
      `status: ${item.result.status}`,
      `category: ${item.result.category} (${item.result.categoryName})`,
      `type: ${item.result.type}`,
      `redeemed_at: ${item.result.redeemedAt}`,
      "",
      "--- content ---",
      item.result.contentEncoding === "base64"
        ? `(binary base64, ${item.result.size ?? "?"} bytes — see companion file if present)`
        : item.result.content || "(空)",
    );
  } else {
    lines.push(
      "status: error",
      `error: ${item.error || "兑换失败"}`,
      "",
      "--- content ---",
      "(无)",
    );
  }
  return lines.join("\n");
}

/** 将批量结果打包为 ZIP Blob（二进制类型写入真实文件） */
export async function buildRedeemZip(
  items: BatchRedeemItem[],
  opts?: { folderName?: string },
): Promise<Blob> {
  const zip = new JSZip();
  const folder = opts?.folderName
    ? zip.folder(opts.folderName) ?? zip
    : zip;

  const summary = [
    "CardKey 批量兑换汇总",
    "====================",
    `total: ${items.length}`,
    `success: ${items.filter((i) => i.ok).length}`,
    `failed: ${items.filter((i) => !i.ok).length}`,
    "",
    ...items.map((i, idx) => {
      const flag = i.ok ? "OK" : "FAIL";
      const detail = i.ok
        ? `${i.result?.status ?? "ok"} type=${i.result?.type ?? "-"}`
        : i.error ?? "error";
      return `${String(idx + 1).padStart(3, "0")}  [${flag}]  ${i.code}  ${detail}`;
    }),
  ].join("\n");
  folder.file("_summary.txt", summary);

  items.forEach((item, i) => {
    if (item.ok && item.result && (
      item.result.contentEncoding === "base64" ||
      isBinaryCardType(item.result.type)
    )) {
      try {
        const bytes = base64ToUint8Array(item.result.content);
        const name =
          item.result.filename
            ? `${String(i + 1).padStart(3, "0")}_${item.result.filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")}`
            : safeFileName(item.code, i, extFromResult(item.result));
        folder.file(name, bytes);
        // 元数据旁路
        folder.file(
          safeFileName(item.code, i, ".meta.txt"),
          formatRedeemFile(item),
        );
        return;
      } catch {
        // fallthrough 文本
      }
    }
    folder.file(safeFileName(item.code, i, ".txt"), formatRedeemFile(item));
  });

  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export function parseRedeemCodes(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const code = line.trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}
