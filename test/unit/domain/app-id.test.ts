import { describe, expect, it } from "vitest";

import { parseAppId } from "../../../src/domain/app-id.js";

describe("parseAppId", () => {
  it("preserves a valid positive Steam app ID", () => {
    expect(parseAppId(570)).toBe(570);
  });

  it("rejects a fractional Steam app ID", () => {
    expect(() => parseAppId(570.5)).toThrow("Invalid Steam app ID");
  });

  it("rejects a non-positive Steam app ID", () => {
    expect(() => parseAppId(0)).toThrow("Invalid Steam app ID");
  });

  it("rejects a Steam app ID above the unsigned 32-bit range", () => {
    expect(() => parseAppId(4_294_967_296)).toThrow("Invalid Steam app ID");
  });
});
