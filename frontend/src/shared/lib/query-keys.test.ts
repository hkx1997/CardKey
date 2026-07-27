import { describe, expect, it } from "vitest";

import { queryKeys } from "./query-keys";

describe("queryKeys", () => {
  it("keeps stable base keys", () => {
    expect(queryKeys.settings).toEqual(["settings"]);
    expect(queryKeys.categories).toEqual(["categories"]);
  });

  it("scopes list keys by params", () => {
    expect(queryKeys.cards({ page: 1 })).toEqual(["cards", { page: 1 }]);
    expect(queryKeys.cards()).toEqual(["cards"]);
  });
});
