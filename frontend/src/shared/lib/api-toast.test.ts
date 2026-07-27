import { describe, expect, it } from "vitest";

import { ApiError } from "@/entities/types";

import { getErrorMessage } from "./api-toast";

describe("getErrorMessage", () => {
  it("reads ApiError message", () => {
    expect(getErrorMessage(new ApiError(400, "X", "业务错误"))).toBe(
      "业务错误",
    );
  });

  it("falls back for unknown", () => {
    expect(getErrorMessage(null, "失败")).toBe("失败");
  });

  it("reads Error.message", () => {
    expect(getErrorMessage(new Error("oops"))).toBe("oops");
  });
});
