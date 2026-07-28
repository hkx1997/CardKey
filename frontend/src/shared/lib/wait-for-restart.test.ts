import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isLikelyRestartDisconnect,
  RELOAD_COUNTDOWN_SEC,
  waitForRestartAndReload,
} from "./wait-for-restart";

describe("RELOAD_COUNTDOWN_SEC", () => {
  it("is 10 seconds max wait", () => {
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

describe("waitForRestartAndReload early ready", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reloads early when health recovers after downtime", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n += 1;
        // first probes fail (restart), then ok
        if (n < 3) {
          return { ok: false, json: async () => ({}) };
        }
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { status: "ok", version: "0.1.46" },
          }),
        };
      }),
    );
    const replace = vi.fn();
    vi.stubGlobal("location", {
      href: "http://localhost/admin",
      pathname: "/admin",
      search: "",
      replace,
    } as unknown as Location);
    vi.stubGlobal("sessionStorage", { setItem: vi.fn() });

    const statuses: string[] = [];
    const t0 = Date.now();
    await waitForRestartAndReload({
      targetVersion: "0.1.46",
      countdownSec: 10,
      onStatus: (s) => statuses.push(s.phase + ":" + s.message),
    });
    const elapsed = Date.now() - t0;

    expect(replace).toHaveBeenCalled();
    expect(n).toBeGreaterThanOrEqual(3);
    // 提前就绪应远小于 10s
    expect(elapsed).toBeLessThan(5000);
    expect(statuses.some((s) => s.startsWith("ready:"))).toBe(true);
  });
});
