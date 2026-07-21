import { describe, expect, it } from "vitest";

import { createHttpRequestBoundary } from "../../../src/infrastructure/http-request-boundary.js";

const boundary = createHttpRequestBoundary({
  allowedHosts: ["steam.example", "steam.example:8443"],
  allowedOrigins: ["https://chatgpt.com", "https://claude.ai"],
});

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe("createHttpRequestBoundary", () => {
  it.each(["steam.example", "STEAM.EXAMPLE", "steam.example:443"])(
    "accepts canonical host %s",
    (host) => {
      expect(boundary.check(headers({ host }))).toEqual({ allowed: true });
    },
  );

  it.each([
    ["missing", {}, "malformed_host"],
    ["disallowed", { host: "attacker.example" }, "disallowed_host"],
    ["multiple", { host: "steam.example, attacker.example" }, "malformed_host"],
    ["path", { host: "steam.example/private" }, "malformed_host"],
    ["userinfo", { host: "user@steam.example" }, "malformed_host"],
    ["unparseable", { host: "[" }, "malformed_host"],
  ])("rejects a %s Host without reflecting it", (_name, values, reason) => {
    const result = boundary.check(headers(values));

    expect(result).toEqual({ allowed: false, reason });
    expect(JSON.stringify(result)).not.toContain("attacker.example");
  });

  it("allows a missing Origin for non-browser MCP clients", () => {
    expect(boundary.check(headers({ host: "steam.example" }))).toEqual({
      allowed: true,
    });
  });

  it.each(["https://chatgpt.com", "https://claude.ai"])(
    "accepts configured Origin %s",
    (origin) => {
      expect(
        boundary.check(headers({ host: "steam.example", origin })),
      ).toEqual({ allowed: true });
    },
  );

  it.each([
    "null",
    "http://chatgpt.com",
    "https://attacker.example",
    "https://chatgpt.com/path",
    "https://chatgpt.com, https://attacker.example",
    "not-an-origin",
  ])("rejects malformed or disallowed Origin %s", (origin) => {
    expect(boundary.check(headers({ host: "steam.example", origin }))).toEqual({
      allowed: false,
      reason: "invalid_origin",
    });
  });

  it("does not let proxy-forwarded values override the actual Host", () => {
    expect(
      boundary.check(
        headers({
          host: "attacker.example",
          forwarded: "host=steam.example;proto=https",
          "x-forwarded-host": "steam.example",
        }),
      ),
    ).toEqual({ allowed: false, reason: "disallowed_host" });
  });

  it("ignores untrusted forwarded values when the actual boundary is valid", () => {
    expect(
      boundary.check(
        headers({
          host: "steam.example",
          forwarded: "host=attacker.example;proto=http",
          "x-forwarded-host": "attacker.example",
        }),
      ),
    ).toEqual({ allowed: true });
  });

  it.each([
    ["empty hosts", { allowedHosts: [], allowedOrigins: [] }],
    [
      "invalid host",
      { allowedHosts: ["steam.example/private"], allowedOrigins: [] },
    ],
    [
      "invalid origin",
      {
        allowedHosts: ["steam.example"],
        allowedOrigins: ["http://client.example"],
      },
    ],
    [
      "duplicate host",
      { allowedHosts: ["steam.example", "STEAM.EXAMPLE"], allowedOrigins: [] },
    ],
  ])("rejects %s configuration with a safe error", (_name, options) => {
    expect(() => createHttpRequestBoundary(options)).toThrow(
      "Invalid HTTP request boundary configuration",
    );
  });
});
