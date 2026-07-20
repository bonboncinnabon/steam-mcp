import { describe, expect, it } from "vitest";

import { parseSteamId64 } from "../../../src/domain/steam-id.js";

describe("parseSteamId64", () => {
  it("preserves a valid SteamID64 as an exact decimal string", () => {
    const steamId = parseSteamId64("76561198000000001");

    expect(steamId).toBe("76561198000000001");
  });

  it("rejects a non-decimal SteamID64", () => {
    expect(() => parseSteamId64("7656119oops")).toThrow("Invalid SteamID64");
  });

  it("rejects a SteamID64 above the unsigned 64-bit range", () => {
    expect(() => parseSteamId64("18446744073709551616")).toThrow(
      "Invalid SteamID64",
    );
  });
});
