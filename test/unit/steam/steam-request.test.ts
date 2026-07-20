import { describe, expect, it } from "vitest";

import {
  STEAM_HOST_ALLOWLIST,
  buildSteamRequest,
} from "../../../src/steam/http/steam-request.js";

describe("STEAM_HOST_ALLOWLIST", () => {
  it("contains only approved Steam-operated outbound hosts", () => {
    expect(STEAM_HOST_ALLOWLIST).toEqual([
      "api.steampowered.com",
      "store.steampowered.com",
      "steamcommunity.com",
    ]);
  });
});

describe("buildSteamRequest", () => {
  it("constructs a fixed HTTPS request from the endpoint catalog", () => {
    expect(buildSteamRequest("storeDetails", { appids: "570" })).toEqual({
      url: "https://store.steampowered.com/api/appdetails?appids=570",
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "manual",
    });
  });

  it("encodes a model-controlled value without changing request authority", () => {
    expect(
      buildSteamRequest("storeDetails", {
        appids: "570&host=evil.example#fragment",
      }).url,
    ).toBe(
      "https://store.steampowered.com/api/appdetails?appids=570%26host%3Devil.example%23fragment",
    );
  });

  it("rejects an endpoint outside the typed catalog", () => {
    expect(() =>
      buildSteamRequest("unapproved" as "storeDetails", { appids: "570" }),
    ).toThrow("Unknown Steam endpoint");
  });
});
