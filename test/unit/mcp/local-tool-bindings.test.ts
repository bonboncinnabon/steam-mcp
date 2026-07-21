import { describe, expect, it, vi } from "vitest";

import { success } from "../../../src/domain/result.js";
import { createLocalToolBindings } from "../../../src/mcp/local-tool-bindings.js";

describe("local MCP tool bindings", () => {
  it("creates bindings for the complete public tool surface", () => {
    const execute = vi.fn();

    const bindings = createLocalToolBindings({
      getPlayer: { execute },
      getLibrary: { execute },
      getRecentActivity: { execute },
      getAchievements: { execute },
      getFriends: { execute },
      getWishlist: { execute },
      searchGames: { execute },
      getGame: { execute },
    });

    expect(Object.keys(bindings)).toEqual([
      "steam_get_player",
      "steam_get_library",
      "steam_get_recent_activity",
      "steam_get_achievements",
      "steam_get_friends",
      "steam_get_wishlist",
      "steam_search_games",
      "steam_get_game",
    ]);
  });

  it("maps a public player user to explicit identity with the local default", async () => {
    const playerResult = success(
      {
        steamId: "76561198000000001",
        profile: {
          steamId: "76561198000000001",
          displayName: "Ada",
          profileUrl: "https://steamcommunity.com/id/ada",
          visibility: "public" as const,
        },
        bans: {
          steamId: "76561198000000001",
          communityBanned: false,
          vacBanCount: 0,
          gameBanCount: 0,
          economyBan: "none" as const,
        },
      },
      ["supported"],
    );
    const execute = vi.fn().mockResolvedValue(playerResult);
    const bindings = createLocalToolBindings(
      {
        getPlayer: { execute },
        getLibrary: { execute: vi.fn() },
        getRecentActivity: { execute: vi.fn() },
        getAchievements: { execute: vi.fn() },
        getFriends: { execute: vi.fn() },
        getWishlist: { execute: vi.fn() },
        searchGames: { execute: vi.fn() },
        getGame: { execute: vi.fn() },
      },
      "local_steam_user",
    );
    const signal = new AbortController().signal;
    const invoke = bindings.steam_get_player as unknown as (
      input: { readonly user?: string },
      extra: { readonly signal: AbortSignal },
    ) => Promise<unknown>;

    const result = await invoke({ user: "public_steam_user" }, { signal });

    expect(execute).toHaveBeenCalledWith(
      {
        explicitUser: "public_steam_user",
        localDefault: "local_steam_user",
      },
      signal,
    );
    expect(result).toEqual({
      content: [{ type: "text", text: "Steam player: Ada." }],
      structuredContent: playerResult,
    });
    expect(JSON.stringify(result)).not.toContain("local_steam_user");
  });

  it("passes game-search input unchanged without injecting identity", async () => {
    const searchResult = success(
      {
        query: "portal",
        candidates: [{ appId: 400, name: "Portal" }],
      },
      ["best_effort"],
    );
    const execute = vi.fn().mockResolvedValue(searchResult);
    const bindings = createLocalToolBindings(
      {
        getPlayer: { execute: vi.fn() },
        getLibrary: { execute: vi.fn() },
        getRecentActivity: { execute: vi.fn() },
        getAchievements: { execute: vi.fn() },
        getFriends: { execute: vi.fn() },
        getWishlist: { execute: vi.fn() },
        searchGames: { execute },
        getGame: { execute: vi.fn() },
      },
      "local_steam_user",
    );
    const signal = new AbortController().signal;
    const invoke = bindings.steam_search_games as unknown as (
      input: { readonly query: string; readonly limit: number },
      extra: { readonly signal: AbortSignal },
    ) => Promise<unknown>;

    const result = await invoke({ query: "portal", limit: 3 }, { signal });

    expect(execute).toHaveBeenCalledWith({ query: "portal", limit: 3 }, signal);
    expect(result).toEqual({
      content: [{ type: "text", text: 'Found 1 Steam game for "portal".' }],
      structuredContent: searchResult,
    });
  });

  it("passes game-detail input unchanged without injecting identity", async () => {
    const gameResult = success(
      {
        appId: 400,
        facets: {
          storeDetails: {
            appId: 400,
            name: "Portal",
            developers: ["Valve"],
            publishers: ["Valve"],
            genres: ["Puzzle"],
            categories: ["Single-player"],
          },
        },
        unavailableFacets: [],
      },
      ["best_effort"],
    );
    const execute = vi.fn().mockResolvedValue(gameResult);
    const bindings = createLocalToolBindings(
      {
        getPlayer: { execute: vi.fn() },
        getLibrary: { execute: vi.fn() },
        getRecentActivity: { execute: vi.fn() },
        getAchievements: { execute: vi.fn() },
        getFriends: { execute: vi.fn() },
        getWishlist: { execute: vi.fn() },
        searchGames: { execute: vi.fn() },
        getGame: { execute },
      },
      "local_steam_user",
    );
    const signal = new AbortController().signal;
    const input = { appId: 400, facets: ["reviews" as const] };
    const invoke = bindings.steam_get_game as unknown as (
      toolInput: typeof input,
      extra: { readonly signal: AbortSignal },
    ) => Promise<unknown>;

    const result = await invoke(input, { signal });

    expect(execute).toHaveBeenCalledWith(input, signal);
    expect(result).toEqual({
      content: [{ type: "text", text: "Steam game: Portal (app 400)." }],
      structuredContent: gameResult,
    });
  });

  it("maps and renders the remaining subject-oriented tools", async () => {
    const localDefault = "local_steam_user";
    const steamId = "76561198000000001";
    const getLibrary = vi
      .fn()
      .mockResolvedValue(
        success(
          { steamId, games: [{ appId: 10 }, { appId: 20 }], totalCount: 12 },
          ["supported"],
        ),
      );
    const getRecentActivity = vi.fn().mockResolvedValue(
      success(
        {
          steamId,
          recentGames: [{ appId: 10 }],
          currentActivity: { status: "not_playing" },
        },
        ["supported"],
      ),
    );
    const getAchievements = vi.fn().mockResolvedValue(
      success(
        {
          steamId,
          appId: 10,
          achievements: [{}, {}, {}],
          totalCount: 10,
        },
        ["supported", "derived"],
      ),
    );
    const getFriends = vi
      .fn()
      .mockResolvedValue(
        success({ steamId, friends: [{}, {}], totalCount: 20 }, ["supported"]),
      );
    const getWishlist = vi
      .fn()
      .mockResolvedValue(
        success({ steamId, items: [{}, {}, {}, {}], totalCount: 8 }, [
          "best_effort",
        ]),
      );
    const bindings = createLocalToolBindings(
      {
        getPlayer: { execute: vi.fn() },
        getLibrary: { execute: getLibrary },
        getRecentActivity: { execute: getRecentActivity },
        getAchievements: { execute: getAchievements },
        getFriends: { execute: getFriends },
        getWishlist: { execute: getWishlist },
        searchGames: { execute: vi.fn() },
        getGame: { execute: vi.fn() },
      },
      localDefault,
    );
    const signal = new AbortController().signal;

    const results = await Promise.all([
      invoke(bindings.steam_get_library, { user: "ada", limit: 2 }, signal),
      invoke(
        bindings.steam_get_recent_activity,
        { user: "ada", limit: 1 },
        signal,
      ),
      invoke(
        bindings.steam_get_achievements,
        { user: "ada", appId: 10, limit: 3 },
        signal,
      ),
      invoke(bindings.steam_get_friends, { user: "ada", limit: 2 }, signal),
      invoke(bindings.steam_get_wishlist, { user: "ada", limit: 4 }, signal),
    ]);

    expect([
      getLibrary.mock.calls[0]?.[0],
      getRecentActivity.mock.calls[0]?.[0],
      getAchievements.mock.calls[0]?.[0],
      getFriends.mock.calls[0]?.[0],
      getWishlist.mock.calls[0]?.[0],
    ]).toEqual([
      { explicitUser: "ada", localDefault, limit: 2 },
      { explicitUser: "ada", localDefault, limit: 1 },
      { explicitUser: "ada", localDefault, appId: 10, limit: 3 },
      { explicitUser: "ada", localDefault, limit: 2 },
      { explicitUser: "ada", localDefault, limit: 4 },
    ]);
    expect(
      results.map(
        (result) =>
          (result as { content: readonly [{ text: string }] }).content[0].text,
      ),
    ).toEqual([
      "Steam library: 2 of 12 games.",
      "Recent Steam activity: 1 game.",
      "Steam achievements: 3 of 10.",
      "Steam friends: 2 of 20.",
      "Steam wishlist: 4 of 8 games.",
    ]);
    expect(JSON.stringify(results)).not.toContain(localDefault);
  });
});

async function invoke(
  binding: unknown,
  input: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  const handler = binding as (
    toolInput: unknown,
    extra: { readonly signal: AbortSignal },
  ) => Promise<unknown>;
  return handler(input, { signal });
}
