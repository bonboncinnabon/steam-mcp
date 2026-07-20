import { describe, expect, it } from "vitest";

import {
  sanitizeSteamUrl,
  validateSteamRedirect,
} from "../../../src/steam/http/steam-http-policy.js";

describe("validateSteamRedirect", () => {
  it("preserves an HTTPS redirect to an allowlisted Steam host", () => {
    const location = "https://store.steampowered.com/api/appdetails?appids=570";

    expect(validateSteamRedirect(location)).toBe(location);
  });

  it("rejects a redirect to a host outside the Steam allowlist", () => {
    expect(() => validateSteamRedirect("https://evil.example/collect")).toThrow(
      "Blocked Steam redirect",
    );
  });

  it("rejects a non-HTTPS redirect to an allowlisted host", () => {
    expect(() =>
      validateSteamRedirect("http://store.steampowered.com/api/appdetails"),
    ).toThrow("Blocked Steam redirect");
  });

  it("sanitizes malformed redirect failures", () => {
    expect(() =>
      validateSteamRedirect("not a URL?key=synthetic-secret"),
    ).toThrow("Blocked Steam redirect");
  });

  it("resolves and validates a relative redirect against its current Steam URL", () => {
    expect(
      validateSteamRedirect(
        "/api/appdetails?appids=570",
        "https://store.steampowered.com/old-path",
      ),
    ).toBe("https://store.steampowered.com/api/appdetails?appids=570");
  });
});

describe("sanitizeSteamUrl", () => {
  it("removes credentials, query parameters, and fragments", () => {
    expect(
      sanitizeSteamUrl(
        "https://client:secret@api.steampowered.com/path?key=synthetic-secret&steamid=1#private",
      ),
    ).toBe("https://api.steampowered.com/path");
  });
});
