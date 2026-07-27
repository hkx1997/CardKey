import { describe, expect, it } from "vitest";

import {
  formatRedeemFile,
  parseRedeemCodes,
  safeFileName,
  type BatchRedeemItem,
} from "./redeem-zip";

describe("parseRedeemCodes", () => {
  it("splits lines, trims, uppercases, dedupes", () => {
    expect(
      parseRedeemCodes("  vip-a  \n\nvip-a\nCDK-b\n"),
    ).toEqual(["VIP-A", "CDK-B"]);
  });
});

describe("safeFileName", () => {
  it("prefixes index and strips illegal chars", () => {
    expect(safeFileName('VIP:A/B', 0)).toBe("001_VIP_A_B.txt");
  });
});

describe("formatRedeemFile", () => {
  it("writes success content", () => {
    const item: BatchRedeemItem = {
      code: "VIP-1",
      ok: true,
      result: {
        status: "success",
        category: "vip",
        categoryName: "VIP",
        code: "VIP-1",
        type: "text",
        content: "hello",
        redeemedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const text = formatRedeemFile(item);
    expect(text).toContain("status: success");
    expect(text).toContain("hello");
  });

  it("writes error", () => {
    const text = formatRedeemFile({
      code: "X",
      ok: false,
      error: "卡密不存在",
    });
    expect(text).toContain("status: error");
    expect(text).toContain("卡密不存在");
  });
});
