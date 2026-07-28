import { describe, expect, it } from "vitest";

import { isLikelyRestartDisconnect, RELOAD_COUNTDOWN_SEC } from "./wait-for-restart";

describe("RELOAD_COUNTDOWN_SEC", () => {
  it("is 10 seconds", () => {
    expect(RELOAD_COUNTDOWN_SEC).toBe(10);
  });
});

describe("isLikelyRestartDisconnect", () => {
  it("treats TypeError / failed to fetch as disconnect", () => {
    expect(isLikelyRestartDisconnect(new TypeError("Failed to fetch"))).toBe(
      true,
    );
  });

  it("treats 502/503 as disconnect", () => {
    expect(isLikelyRestartDisconnect({ status: 502 })).toBe(true);
    expect(isLikelyRestartDisconnect({ status: 503 })).toBe(true);
  });

  it("does not treat validation as disconnect", () => {
    expect(
      isLikelyRestartDisconnect({
        status: 400,
        message: "无法解析目标版本",
      }),
    ).toBe(false);
  });
});
