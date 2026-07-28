import { describe, expect, it } from "vitest";

import { isLikelyRestartDisconnect, shouldReloadAfterProbe } from "./wait-for-restart";

describe("shouldReloadAfterProbe", () => {
  it("waits while healthz is down", () => {
    expect(
      shouldReloadAfterProbe({
        ok: false,
        sawDown: true,
        target: "0.1.33",
        previous: "0.1.32",
        attempt: 3,
        pastGrace: true,
      }),
    ).toBe("wait");
  });

  it("reloads when target version matches after grace", () => {
    expect(
      shouldReloadAfterProbe({
        ok: true,
        version: "0.1.33",
        sawDown: false,
        target: "0.1.33",
        previous: "0.1.32",
        attempt: 2,
        pastGrace: true,
      }),
    ).toBe("reload");
  });

  it("reloads when version changed from previous after downtime", () => {
    expect(
      shouldReloadAfterProbe({
        ok: true,
        version: "0.1.30",
        sawDown: true,
        previous: "0.1.32",
        attempt: 4,
        pastGrace: true,
      }),
    ).toBe("reload");
  });

  it("waits for target if recovered on wrong version", () => {
    expect(
      shouldReloadAfterProbe({
        ok: true,
        version: "0.1.32",
        sawDown: true,
        target: "0.1.33",
        previous: "0.1.32",
        attempt: 5,
        pastGrace: true,
      }),
    ).toBe("wait_for_target");
  });

  it("does not reload on same version without downtime before grace", () => {
    expect(
      shouldReloadAfterProbe({
        ok: true,
        version: "0.1.32",
        sawDown: false,
        target: "0.1.33",
        previous: "0.1.32",
        attempt: 1,
        pastGrace: false,
      }),
    ).toBe("wait");
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

  it("does not treat normal ApiError validation as disconnect", () => {
    expect(
      isLikelyRestartDisconnect({
        status: 400,
        message: "无法解析目标版本",
      }),
    ).toBe(false);
  });
});
