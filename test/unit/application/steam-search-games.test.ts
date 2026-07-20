import { describe, expect, it, vi } from "vitest";

import { createSteamSearchGamesService } from "../../../src/application/services/steam-search-games.js";
import { parseAppId } from "../../../src/domain/app-id.js";
import { parseCurrencyCode } from "../../../src/domain/currency.js";

describe("steam_search_games application service", () => {
  it("rejects a blank query without invoking an upstream source", async () => {
    const searchGames = vi.fn();
    const service = createSteamSearchGamesService({
      steamData: { searchGames },
      maxResults: 10,
    });

    await expect(
      service.execute(
        { query: "   ", limit: 10 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(searchGames).not.toHaveBeenCalled();
  });

  it("preserves ranked ambiguous candidates and disambiguating evidence", async () => {
    const signal = new AbortController().signal;
    const candidates = [
      {
        appId: parseAppId(400),
        name: "Portal",
        price: { minorUnits: 499, currency: parseCurrencyCode("USD") },
        platforms: { windows: true, mac: true, linux: true },
        metascore: 90,
      },
      {
        appId: parseAppId(620),
        name: "Portal 2",
        platforms: { windows: true, mac: true, linux: true },
        metascore: 95,
      },
    ];
    const searchGames = vi.fn().mockResolvedValue(candidates);
    const service = createSteamSearchGamesService({
      steamData: { searchGames },
      maxResults: 10,
    });

    await expect(
      service.execute({ query: "  portal  ", limit: 10 }, signal),
    ).resolves.toEqual({
      ok: true,
      data: { query: "portal", candidates },
      meta: {
        schema_version: "1",
        source_tiers: ["best_effort"],
        partial: false,
        warnings: [],
      },
    });
    expect(searchGames).toHaveBeenCalledWith("portal", signal);
  });

  it.each([
    { query: "x".repeat(101), limit: 10 },
    { query: "portal", limit: 0 },
    { query: "portal", limit: 11 },
  ])("rejects invalid search bounds before upstream work", async (input) => {
    const searchGames = vi.fn();
    const service = createSteamSearchGamesService({
      steamData: { searchGames },
      maxResults: 10,
    });

    await expect(
      service.execute(input, new AbortController().signal),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(searchGames).not.toHaveBeenCalled();
  });

  it.each([0, 1.5, 11])(
    "rejects an invalid maximum result count",
    (maxResults) => {
      expect(() =>
        createSteamSearchGamesService({
          steamData: { searchGames: vi.fn() },
          maxResults,
        }),
      ).toThrow("Game search maximum must be between 1 and 10");
    },
  );

  it("returns only the requested ranked prefix without silent selection", async () => {
    const candidates = [
      { appId: parseAppId(1), name: "Alpha" },
      { appId: parseAppId(2), name: "Alpha Deluxe" },
      { appId: parseAppId(3), name: "Alpha Remastered" },
    ];
    const service = createSteamSearchGamesService({
      steamData: { searchGames: vi.fn().mockResolvedValue(candidates) },
      maxResults: 10,
    });

    await expect(
      service.execute(
        { query: "Alpha", limit: 2 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { candidates: candidates.slice(0, 2) },
    });
  });

  it("preserves an empty ranked result as a successful search", async () => {
    const service = createSteamSearchGamesService({
      steamData: { searchGames: vi.fn().mockResolvedValue([]) },
      maxResults: 10,
    });

    await expect(
      service.execute(
        { query: "No Such Synthetic Game", limit: 10 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { candidates: [] },
      meta: { partial: false, warnings: [] },
    });
  });

  it("propagates a sanitized upstream search failure", async () => {
    const upstreamFailure = Object.assign(new Error("Store search changed"), {
      code: "BEST_EFFORT_SOURCE_CHANGED",
      retryable: false,
    });
    const service = createSteamSearchGamesService({
      steamData: { searchGames: vi.fn().mockRejectedValue(upstreamFailure) },
      maxResults: 10,
    });

    await expect(
      service.execute(
        { query: "Portal", limit: 10 },
        new AbortController().signal,
      ),
    ).rejects.toBe(upstreamFailure);
  });
});
