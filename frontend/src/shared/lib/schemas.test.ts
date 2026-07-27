import { describe, expect, it } from "vitest";

import {
  apiKeyCreateSchema,
  cardCreateSchema,
  categoryCreateSchema,
  customApiKeySchema,
  fieldErrors,
  importCardsSchema,
  loginSchema,
  redeemSchema,
} from "./schemas";

describe("loginSchema", () => {
  it("accepts non-empty credentials", () => {
    const r = fieldErrors(loginSchema, {
      username: "admin",
      password: "admin123",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects empty username", () => {
    const r = fieldErrors(loginSchema, { username: "  ", password: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.username).toBeTruthy();
  });
});

describe("categoryCreateSchema", () => {
  it("normalizes valid input", () => {
    const r = fieldErrors(categoryCreateSchema, {
      name: "VIP",
      slug: "vip",
      codePrefix: "VIP",
      description: "",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects bad slug", () => {
    const r = fieldErrors(categoryCreateSchema, {
      name: "VIP",
      slug: "VIP!",
      codePrefix: "VIP",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.slug).toBeTruthy();
  });
});

describe("cardCreateSchema", () => {
  it("requires category and content", () => {
    const r = fieldErrors(cardCreateSchema, {
      categoryId: "",
      content: "",
      type: "text",
      note: "",
    });
    expect(r.ok).toBe(false);
  });

  it("accepts valid card", () => {
    const r = fieldErrors(cardCreateSchema, {
      categoryId: "c1",
      content: "secret",
      type: "text",
      note: "",
    });
    expect(r.ok).toBe(true);
  });
});

describe("importCardsSchema", () => {
  it("requires raw lines", () => {
    const r = fieldErrors(importCardsSchema, {
      categoryId: "c1",
      raw: "   ",
      type: "text",
      batchName: "b",
    });
    expect(r.ok).toBe(false);
  });
});

describe("apiKeyCreateSchema", () => {
  it("requires scopes", () => {
    const r = fieldErrors(apiKeyCreateSchema, {
      name: "k",
      scopes: [],
    });
    expect(r.ok).toBe(false);
  });
});

describe("redeemSchema", () => {
  it("requires code length", () => {
    const r = fieldErrors(redeemSchema, { category: "vip", code: "ab" });
    expect(r.ok).toBe(false);
  });

  it("accepts demo-like code", () => {
    const r = fieldErrors(redeemSchema, {
      category: "vip",
      code: "VIP-DEMO-7K3M",
    });
    expect(r.ok).toBe(true);
  });
});

describe("customApiKeySchema", () => {
  it("requires >=16 chars", () => {
    expect(customApiKeySchema.safeParse("short").success).toBe(false);
    expect(
      customApiKeySchema.safeParse("1234567890123456").success,
    ).toBe(true);
  });
});
