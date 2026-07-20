import { describe, expect, it } from "vitest";

import { parseIsoTimestamp } from "../../../src/domain/iso-timestamp.js";

describe("parseIsoTimestamp", () => {
  it("preserves a canonical ISO 8601 UTC timestamp", () => {
    const timestamp = "2026-07-20T08:15:30.000Z";

    expect(parseIsoTimestamp(timestamp)).toBe(timestamp);
  });

  it("rejects an ISO timestamp that is not expressed in UTC", () => {
    expect(() => parseIsoTimestamp("2026-07-20T13:45:30+05:30")).toThrow(
      "Invalid ISO 8601 UTC timestamp",
    );
  });

  it("rejects a malformed timestamp ending in Z", () => {
    expect(() => parseIsoTimestamp("not-a-dateZ")).toThrow(
      "Invalid ISO 8601 UTC timestamp",
    );
  });
});
