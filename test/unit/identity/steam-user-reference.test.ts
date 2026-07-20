import { describe, expect, it } from "vitest";

import { parseSteamUserReference } from "../../../src/identity/steam-user-reference.js";

describe("parseSteamUserReference", () => {
  it("preserves a SteamID64 as a string", () => {
    expect(parseSteamUserReference("76561198000000000")).toEqual({
      kind: "steam_id",
      steamId: "76561198000000000",
    });
  });

  it("accepts a conservative Steam vanity name", () => {
    expect(parseSteamUserReference("portal_fan-2")).toEqual({
      kind: "vanity",
      vanity: "portal_fan-2",
    });
  });

  it("extracts a SteamID64 from an allowlisted community profile URL", () => {
    expect(
      parseSteamUserReference(
        "https://steamcommunity.com/profiles/76561198000000000/",
      ),
    ).toEqual({
      kind: "steam_id",
      steamId: "76561198000000000",
    });
  });

  it("extracts a vanity name from an allowlisted community URL", () => {
    expect(
      parseSteamUserReference("https://steamcommunity.com/id/portal_fan-2"),
    ).toEqual({
      kind: "vanity",
      vanity: "portal_fan-2",
    });
  });

  it("treats a short numeric name as vanity rather than a SteamID64", () => {
    expect(parseSteamUserReference("1234")).toEqual({
      kind: "vanity",
      vanity: "1234",
    });
  });

  it("rejects a profiles URL whose identifier is not a SteamID64", () => {
    expect(() =>
      parseSteamUserReference("https://steamcommunity.com/profiles/1234"),
    ).toThrow("Invalid Steam user reference");
  });

  it("rejects non-HTTPS, ambiguous, credentialed, and non-Steam profile URLs", () => {
    const disallowed = [
      "http://steamcommunity.com/id/portal_fan",
      "https://steamcommunity.com.evil.example/id/portal_fan",
      "https://steamcommunity.com@evil.example/id/portal_fan",
      "https://steamcommunity.com/id/portal_fan?next=evil",
      "https://steamcommunity.com/id/portal_fan#private",
      "https://steamcommunity.com/id/portal_fan/extra",
      "javascript://steamcommunity.com/id/portal_fan",
    ];

    for (const input of disallowed) {
      expect(() => parseSteamUserReference(input)).toThrow(
        "Invalid Steam user reference",
      );
    }
  });

  it("rejects malformed URLs and vanity names outside conservative bounds", () => {
    for (const input of [
      "https://[",
      "x",
      "a".repeat(33),
      "contains space",
      "contains.dot",
      "påss",
    ]) {
      expect(() => parseSteamUserReference(input)).toThrow(
        "Invalid Steam user reference",
      );
    }
  });
});
