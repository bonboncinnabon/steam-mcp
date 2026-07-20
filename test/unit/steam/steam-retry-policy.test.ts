import { describe, expect, it } from "vitest";

import {
  calculateSteamRetryDelay,
  classifySteamHttpStatus,
  classifySteamNetworkFailure,
} from "../../../src/steam/http/steam-retry-policy.js";

describe("classifySteamHttpStatus", () => {
  it("classifies an authentication rejection as non-retryable", () => {
    expect(classifySteamHttpStatus(401)).toEqual({
      code: "STEAM_AUTH_FAILED",
      retryable: false,
    });
  });

  it("uses delta-seconds retry guidance for a rate-limit response", () => {
    expect(
      classifySteamHttpStatus(429, new Headers({ "retry-after": "2" })),
    ).toEqual({
      code: "STEAM_RATE_LIMITED",
      retryable: true,
      retryAfterMs: 2_000,
    });
  });

  it("omits retry guidance when a rate-limit response provides none", () => {
    expect(classifySteamHttpStatus(429)).toEqual({
      code: "STEAM_RATE_LIMITED",
      retryable: true,
    });
  });

  it("uses HTTP-date retry guidance relative to the supplied clock", () => {
    const nowMs = Date.parse("2026-07-20T08:00:00.000Z");
    const headers = new Headers({
      "retry-after": new Date(nowMs + 5_000).toUTCString(),
    });

    expect(classifySteamHttpStatus(429, headers, nowMs)).toEqual({
      code: "STEAM_RATE_LIMITED",
      retryable: true,
      retryAfterMs: 5_000,
    });
  });

  it("retries only the selected transient server statuses", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classifySteamHttpStatus(status)).toEqual({
        code: "UPSTREAM_UNAVAILABLE",
        retryable: true,
      });
    }
  });

  it("does not retry an unselected server status", () => {
    expect(classifySteamHttpStatus(501)).toEqual({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: false,
    });
  });
});

describe("calculateSteamRetryDelay", () => {
  it("applies deterministic full jitter to exponential backoff", () => {
    expect(
      calculateSteamRetryDelay({
        attempt: 2,
        baseDelayMs: 200,
        maxDelayMs: 5_000,
        random: () => 0.5,
      }),
    ).toBe(400);
  });

  it("honors retry guidance without exceeding the delay bound", () => {
    expect(
      calculateSteamRetryDelay({
        attempt: 0,
        baseDelayMs: 200,
        maxDelayMs: 2_000,
        retryAfterMs: 3_000,
        random: () => 0,
      }),
    ).toBe(2_000);
  });
});

describe("classifySteamNetworkFailure", () => {
  it("retries an allowlisted transient network error code", () => {
    expect(classifySteamNetworkFailure({ code: "ETIMEDOUT" })).toEqual({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
    });
  });

  it("recognizes a transient code nested in a fetch error cause", () => {
    expect(
      classifySteamNetworkFailure({ cause: { code: "ECONNRESET" } }),
    ).toEqual({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
    });
  });
});
