import { describe, expect, it } from "vitest";

import { parsePaginationCursor } from "../../../src/domain/pagination-cursor.js";

describe("parsePaginationCursor", () => {
  it("preserves a non-empty base64url cursor", () => {
    expect(parsePaginationCursor("eyJvZmZzZXQiOjIwfQ")).toBe(
      "eyJvZmZzZXQiOjIwfQ",
    );
  });

  it("rejects an empty cursor", () => {
    expect(() => parsePaginationCursor("")).toThrow(
      "Invalid pagination cursor",
    );
  });

  it("rejects a cursor outside the base64url alphabet", () => {
    expect(() => parsePaginationCursor("not a cursor!")).toThrow(
      "Invalid pagination cursor",
    );
  });

  it("rejects a cursor longer than 512 characters", () => {
    expect(() => parsePaginationCursor("a".repeat(513))).toThrow(
      "Invalid pagination cursor",
    );
  });
});
