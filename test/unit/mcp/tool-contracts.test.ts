import { describe, expect, it } from "vitest";

import { encodeOpaqueCursor } from "../../../src/application/pagination/opaque-cursor.js";
import {
  createSteamToolContracts,
  STEAM_TOOL_CONTRACTS,
  TOOL_FAILURE_OUTPUT_SCHEMA,
} from "../../../src/mcp/tool-contracts.js";

describe("Steam MCP tool contracts", () => {
  it("exposes exactly the eight approved Steam data tools", () => {
    expect(Object.keys(STEAM_TOOL_CONTRACTS)).toEqual([
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

  it("describes every tool as a read-only idempotent Steam operation", () => {
    for (const contract of Object.values(STEAM_TOOL_CONTRACTS)) {
      expect(contract.title.length).toBeGreaterThan(0);
      expect(contract.description.length).toBeGreaterThan(40);
      expect(contract.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      });
    }
  });

  it("validates the optional public user reference without exposing internal identity fields", () => {
    const schema = STEAM_TOOL_CONTRACTS.steam_get_player.inputSchema;

    expect(
      schema.parse({ user: "https://steamcommunity.com/id/agent-test" }),
    ).toEqual({
      user: "https://steamcommunity.com/id/agent-test",
    });
    expect(() => schema.parse({ subject: "internal" })).toThrow();
    expect(() => schema.parse({ user: "not a valid reference" })).toThrow();
  });

  it("documents the local-only identity default without suggesting account linking", () => {
    const description =
      STEAM_TOOL_CONTRACTS.steam_get_player.inputSchema.shape.user.unwrap()
        .description;

    expect(description).toContain("STEAM_USER in local mode");
    expect(description).not.toContain("linked");
  });

  it("applies bounded library defaults and rejects unknown fields", () => {
    const schema = STEAM_TOOL_CONTRACTS.steam_get_library.inputSchema;
    const cursor = encodeOpaqueCursor({ version: 1, offset: 20 });

    expect(schema.parse({})).toEqual({
      limit: 20,
      played: "all",
      sortBy: "name",
      sortDirection: "asc",
    });
    expect(schema.parse({ cursor }).cursor).toBe(cursor);
    expect(() => schema.parse({ limit: 101 })).toThrow();
    expect(() => schema.parse({ includeApps: true })).toThrow();
  });

  it("applies bounded defaults to player collection tools", () => {
    expect(
      STEAM_TOOL_CONTRACTS.steam_get_recent_activity.inputSchema.parse({}),
    ).toEqual({ limit: 20 });
    expect(
      STEAM_TOOL_CONTRACTS.steam_get_achievements.inputSchema.parse({
        appId: 620,
      }),
    ).toEqual({ appId: 620, limit: 20, state: "all" });
    expect(
      STEAM_TOOL_CONTRACTS.steam_get_friends.inputSchema.parse({}),
    ).toEqual({ limit: 20, includePresence: false });
    expect(
      STEAM_TOOL_CONTRACTS.steam_get_wishlist.inputSchema.parse({}),
    ).toEqual({ limit: 20 });
  });

  it("strictly validates bounded game search and selected game facets", () => {
    expect(
      STEAM_TOOL_CONTRACTS.steam_search_games.inputSchema.parse({
        query: "  Portal  ",
      }),
    ).toEqual({ query: "Portal", limit: 10 });
    expect(
      STEAM_TOOL_CONTRACTS.steam_get_game.inputSchema.parse({ appId: 620 }),
    ).toEqual({ appId: 620, facets: [] });
    expect(() =>
      STEAM_TOOL_CONTRACTS.steam_get_game.inputSchema.parse({
        appId: 620,
        facets: ["reviews", "reviews"],
      }),
    ).toThrow();
    expect(() =>
      STEAM_TOOL_CONTRACTS.steam_search_games.inputSchema.parse({
        query: "Portal",
        apiKey: "forbidden",
      }),
    ).toThrow();
  });

  it("validates normalized structured output for every tool", () => {
    const supported = (data: object) => ({
      ok: true as const,
      data,
      meta: {
        schema_version: "1" as const,
        source_tiers: ["supported" as const],
        partial: false,
        warnings: [],
      },
    });

    expect(() =>
      STEAM_TOOL_CONTRACTS.steam_get_player.outputSchema.parse(
        supported({
          steamId: "76561198000000000",
          profile: {
            steamId: "76561198000000000",
            displayName: "Player",
            profileUrl: "https://steamcommunity.com/profiles/76561198000000000",
            visibility: "public",
          },
          bans: {
            steamId: "76561198000000000",
            communityBanned: false,
            vacBanCount: 0,
            gameBanCount: 0,
            economyBan: "none",
          },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      STEAM_TOOL_CONTRACTS.steam_get_library.outputSchema.parse(
        supported({ steamId: "76561198000000000", games: [], totalCount: 0 }),
      ),
    ).not.toThrow();
    expect(() =>
      STEAM_TOOL_CONTRACTS.steam_get_recent_activity.outputSchema.parse(
        supported({
          steamId: "76561198000000000",
          recentGames: [],
          currentActivity: { status: "unavailable" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      STEAM_TOOL_CONTRACTS.steam_get_achievements.outputSchema.parse(
        supported({
          steamId: "76561198000000000",
          appId: 620,
          achievements: [],
          totalCount: 0,
        }),
      ),
    ).not.toThrow();
    expect(() =>
      STEAM_TOOL_CONTRACTS.steam_get_friends.outputSchema.parse(
        supported({ steamId: "76561198000000000", friends: [], totalCount: 0 }),
      ),
    ).not.toThrow();
    expect(() =>
      STEAM_TOOL_CONTRACTS.steam_get_wishlist.outputSchema.parse({
        ...supported({
          steamId: "76561198000000000",
          items: [],
          totalCount: 0,
        }),
        meta: {
          schema_version: "1",
          source_tiers: ["best_effort"],
          partial: false,
          warnings: [],
        },
      }),
    ).not.toThrow();
    expect(() =>
      STEAM_TOOL_CONTRACTS.steam_search_games.outputSchema.parse({
        ...supported({ query: "portal", candidates: [] }),
        meta: {
          schema_version: "1",
          source_tiers: ["best_effort"],
          partial: false,
          warnings: [],
        },
      }),
    ).not.toThrow();
    expect(() =>
      STEAM_TOOL_CONTRACTS.steam_get_game.outputSchema.parse({
        ...supported({
          appId: 620,
          facets: {
            storeDetails: {
              appId: 620,
              name: "Portal 2",
              developers: [],
              publishers: [],
              genres: [],
              categories: [],
            },
          },
          unavailableFacets: [],
        }),
        meta: {
          schema_version: "1",
          source_tiers: ["best_effort"],
          partial: false,
          warnings: [],
        },
      }),
    ).not.toThrow();
  });

  it("validates the stable structured failure envelope", () => {
    expect(
      TOOL_FAILURE_OUTPUT_SCHEMA.parse({
        ok: false,
        error: {
          code: "PROFILE_PRIVATE",
          message: "This Steam profile is private.",
          retryable: false,
        },
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "PROFILE_PRIVATE",
        message: "This Steam profile is private.",
        retryable: false,
      },
    });
    expect(() =>
      TOOL_FAILURE_OUTPUT_SCHEMA.parse({
        ok: false,
        error: { code: "UNKNOWN", message: "bad", retryable: false },
      }),
    ).toThrow();
  });

  it("accepts the shared failure envelope through every advertised output schema", () => {
    const failureResult = {
      ok: false as const,
      error: {
        code: "STEAM_AUTH_FAILED" as const,
        message: "Configure Steam credentials.",
        retryable: false,
      },
    };

    for (const contract of Object.values(STEAM_TOOL_CONTRACTS)) {
      expect(contract.outputSchema.parse(failureResult)).toEqual(failureResult);
      expect(() =>
        contract.outputSchema.parse({
          ...failureResult,
          meta: {
            schema_version: "1",
            source_tiers: [],
            partial: false,
            warnings: [],
          },
        }),
      ).toThrow();
    }
  });

  it("builds collection bounds from the active service policy", () => {
    const contracts = createSteamToolContracts({
      defaultPageSize: 7,
      maxPageSize: 9,
      maxSearchResults: 4,
    });

    expect(contracts.steam_get_library.inputSchema.parse({}).limit).toBe(7);
    expect(() =>
      contracts.steam_get_library.inputSchema.parse({ limit: 10 }),
    ).toThrow();
    expect(
      contracts.steam_search_games.inputSchema.parse({ query: "Portal" }),
    ).toEqual({ query: "Portal", limit: 4 });
  });

  it("rejects invalid tool-contract policy bounds at construction", () => {
    expect(() =>
      createSteamToolContracts({
        defaultPageSize: 10,
        maxPageSize: 5,
        maxSearchResults: 11,
      }),
    ).toThrow(RangeError);
  });
});
