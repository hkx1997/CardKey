import JSZip from "jszip";

import type { RedeemResult } from "@/entities/types";

export type BatchRedeemItem = {
  /** 输入编码 */
  code: string;
  ok: boolean;
  result?: RedeemResult;
  error?: string;
};

/** 文件名安全：去掉路径与非法字符 */
export function safeFileName(code: string, index: number): string {
  const base = code
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
  const name = base || `code_${index + 1}`;
  return `${String(index + 1).padStart(3, "0")}_${name}.txt`;
}

/** 单条兑换结果 → 文件正文 */
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
      item.result.content || "(空)",
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

/** 将批量结果打包为 ZIP Blob */
export async function buildRedeemZip(
  items: BatchRedeemItem[],
  opts?: { folderName?: string },
): Promise<Blob> {
  const zip = new JSZip();
  const folder = opts?.folderName
    ? zip.folder(opts.folderName) ?? zip
    : zip;

  // 汇总索引
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
        ? i.result?.status ?? "ok"
        : i.error ?? "error";
      return `${String(idx + 1).padStart(3, "0")}  [${flag}]  ${i.code}  ${detail}`;
    }),
  ].join("\n");
  folder.file("_summary.txt", summary);

  items.forEach((item, i) => {
    folder.file(safeFileName(item.code, i), formatRedeemFile(item));
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
