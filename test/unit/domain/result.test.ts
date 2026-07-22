import { describe, expect, it } from "vitest";

import {
  ERROR_CODES,
  SOURCE_TIERS,
  failure,
  renderResult,
  success,
} from "../../../src/domain/result.js";

describe("ERROR_CODES", () => {
  it("contains exactly the public v1 error taxonomy", () => {
    expect(ERROR_CODES).toEqual([
      "INVALID_INPUT",
      "IDENTITY_NOT_LINKED",
      "PROFILE_PRIVATE",
      "NOT_FOUND",
      "STEAM_AUTH_FAILED",
      "STEAM_RATE_LIMITED",
      "UPSTREAM_UNAVAILABLE",
      "BEST_EFFORT_SOURCE_CHANGED",
      "SERVICE_QUOTA_EXCEEDED",
      "INTERNAL_ERROR",
    ]);
  });
});

describe("SOURCE_TIERS", () => {
  it("contains exactly the public source classifications", () => {
    expect(SOURCE_TIERS).toEqual(["supported", "best_effort", "derived"]);
  });
});

describe("success", () => {
  it("creates the complete v1 success envelope", () => {
    expect(success({ player: "Ada" }, ["supported"])).toEqual({
      ok: true,
      data: { player: "Ada" },
      meta: {
        schema_version: "1",
        source_tiers: ["supported"],
        partial: false,
        warnings: [],
      },
    });
  });

  it("creates a partial success with warnings", () => {
    expect(
      success({ store: { name: "Portal 2" } }, ["supported", "best_effort"], {
        partial: true,
        warnings: ["Reviews are unavailable."],
      }).meta,
    ).toEqual({
      schema_version: "1",
      source_tiers: ["supported", "best_effort"],
      partial: true,
      warnings: ["Reviews are unavailable."],
    });
  });
});

describe("failure", () => {
  it("creates a stable v1 error envelope", () => {
    expect(
      failure(
        "PROFILE_PRIVATE",
        "This Steam profile does not expose its library publicly.",
        false,
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "PROFILE_PRIVATE",
        message: "This Steam profile does not expose its library publicly.",
        retryable: false,
      },
    });
  });
});

describe("renderResult", () => {
  it("renders error text from the structured error message", () => {
    const result = failure("NOT_FOUND", "No Steam app was found.", false);

    expect(renderResult(result, () => "unused")).toBe(
      "No Steam app was found.",
    );
  });

  it("renders success text from the structured success result", () => {
    const result = success({ player: "Ada" }, ["supported"]);

    expect(
      renderResult(
        result,
        ({ data, meta }) => `${data.player} (${meta.source_tiers.join(", ")})`,
      ),
    ).toBe("Ada (supported)");
  });
});
