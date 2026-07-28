/** 兑换码解析（无重依赖，供兑换页首屏使用） */

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
