import { downloadBlob } from "@/shared/lib/card-content";

/** 将编码列表导出为「一行一个」的 .txt 文件 */
export function downloadCodesTxt(codes: string[], filename: string) {
  const body = codes.join("\n") + (codes.length > 0 ? "\n" : "");
  const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
  const safe =
    filename.replace(/[\\/:*?"<>|]+/g, "_").trim() || "codes-export.txt";
  downloadBlob(blob, safe.endsWith(".txt") ? safe : `${safe}.txt`);
}

export function exportFilename(prefix: string, total: number) {
  const d = new Date();
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
    "-",
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
  ].join("");
  return `${prefix}-${total}-${stamp}.txt`;
}
