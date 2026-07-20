import { describe, expect, it } from "vitest";

import { parseCurrencyCode } from "../../../src/domain/currency.js";

describe("parseCurrencyCode", () => {
  it("preserves an uppercase three-letter currency code", () => {
    expect(parseCurrencyCode("INR")).toBe("INR");
  });

  it("rejects a lowercase currency code", () => {
    expect(() => parseCurrencyCode("inr")).toThrow("Invalid ISO currency code");
  });
});
