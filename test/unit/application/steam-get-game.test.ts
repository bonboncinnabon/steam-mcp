import { describe, expect, it, vi } from "vitest";

import { createSteamGetGameService } from "../../../src/application/services/steam-get-game.js";
import { parseAppId } from "../../../src/domain/app-id.js";
import { BestEffortSourceChangedError } from "../../../src/steam/best-effort/best-effort-response.js";
import { OptionalSourceDisabledError } from "../../../src/steam/optional-source.js";

describe("steam_get_game application service", () => {
  it("returns required store details as the sole compact default", async () => {
    const appId = parseAppId(620);
    const storeDetails = {
      appId,
      name: "Portal 2",
      developers: ["Valve"],
      publishers: ["Valve"],
      genres: ["Puzzle"],
      categories: ["Single-player"],
    };
    const getStoreGame = vi.fn().mockResolvedValue(storeDetails);
    const optionalCalls = {
      getGameReviews: vi.fn(),
      getCurrentPlayers: vi.fn(),
      getDeckCompatibility: vi.fn(),
      getGameNews: vi.fn(),
      getGameAchievementSchema: vi.fn(),
      getGlobalAchievementPercentages: vi.fn(),
    };
    const service = createSteamGetGameService({
      steamData: { getStoreGame, ...optionalCalls },
    });
    const signal = new AbortController().signal;

    await expect(service.execute({ appId }, signal)).resolves.toEqual({
      ok: true,
      data: {
        appId,
        facets: { storeDetails },
        unavailableFacets: [],
      },
      meta: {
        schema_version: "1",
        source_tiers: ["best_effort"],
        partial: false,
        warnings: [],
      },
    });
    expect(getStoreGame).toHaveBeenCalledWith(appId, signal);
    for (const call of Object.values(optionalCalls)) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  it("fetches only the selected current-player facet after store identity", async () => {
    const appId = parseAppId(620);
    const storeDetails = {
      appId,
      name: "Portal 2",
      developers: ["Valve"],
      publishers: ["Valve"],
      genres: ["Puzzle"],
      categories: [],
    };
    const getCurrentPlayers = vi.fn().mockResolvedValue(0);
    const unselectedCalls = {
      getGameReviews: vi.fn(),
      getDeckCompatibility: vi.fn(),
      getGameNews: vi.fn(),
      getGameAchievementSchema: vi.fn(),
      getGlobalAchievementPercentages: vi.fn(),
    };
    const service = createSteamGetGameService({
      steamData: {
        getStoreGame: vi.fn().mockResolvedValue(storeDetails),
        getCurrentPlayers,
        ...unselectedCalls,
      },
    });
    const signal = new AbortController().signal;

    await expect(
      service.execute({ appId, facets: ["current_players"] }, signal),
    ).resolves.toEqual({
      ok: true,
      data: {
        appId,
        facets: { storeDetails, currentPlayers: 0 },
        unavailableFacets: [],
      },
      meta: {
        schema_version: "1",
        source_tiers: ["supported", "best_effort"],
        partial: false,
        warnings: [],
      },
    });
    expect(getCurrentPlayers).toHaveBeenCalledWith(appId, signal);
    for (const call of Object.values(unselectedCalls)) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  it("composes every selected optional facet with canonical source tiers", async () => {
    const appId = parseAppId(620);
    const storeDetails = {
      appId,
      name: "Portal 2",
      developers: ["Valve"],
      publishers: ["Valve"],
      genres: ["Puzzle"],
      categories: [],
    };
    const reviews = {
      totalPositive: 100,
      totalNegative: 5,
      scoreDescription: "Overwhelmingly Positive",
    };
    const deckCompatibility = { category: "verified" as const };
    const news = [
      {
        id: "news-1",
        title: "Synthetic update",
        url: "https://store.steampowered.com/news/app/620/view/1",
        publishedAt: "2026-01-01T00:00:00.000Z" as never,
      },
    ];
    const definitions = [
      { apiName: "ACH_ONE", displayName: "One", hidden: false },
    ];
    const percentages = [{ apiName: "ACH_ONE", globalPercent: 25 }];
    const service = createSteamGetGameService({
      steamData: {
        getStoreGame: vi.fn().mockResolvedValue(storeDetails),
        getGameReviews: vi.fn().mockResolvedValue(reviews),
        getCurrentPlayers: vi.fn().mockResolvedValue(123),
        getDeckCompatibility: vi.fn().mockResolvedValue(deckCompatibility),
        getGameNews: vi.fn().mockResolvedValue(news),
        getGameAchievementSchema: vi.fn().mockResolvedValue(definitions),
        getGlobalAchievementPercentages: vi.fn().mockResolvedValue(percentages),
      },
    });

    await expect(
      service.execute(
        {
          appId,
          facets: [
            "reviews",
            "current_players",
            "deck_compatibility",
            "news",
            "global_achievements",
          ],
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        facets: {
          storeDetails,
          reviews,
          currentPlayers: 123,
          deckCompatibility,
          news,
          globalAchievements: { definitions, percentages },
        },
        unavailableFacets: [],
      },
      meta: {
        source_tiers: ["supported", "best_effort"],
        partial: false,
        warnings: [],
      },
    });
  });

  it("rejects an unknown facet before required store work", async () => {
    const getStoreGame = vi.fn();
    const service = createSteamGetGameService({
      steamData: {
        getStoreGame,
        getGameReviews: vi.fn(),
        getCurrentPlayers: vi.fn(),
        getDeckCompatibility: vi.fn(),
        getGameNews: vi.fn(),
        getGameAchievementSchema: vi.fn(),
        getGlobalAchievementPercentages: vi.fn(),
      },
    });

    await expect(
      service.execute(
        { appId: 620, facets: ["tags" as never] },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(getStoreGame).not.toHaveBeenCalled();
  });

  it("rejects duplicate facets before required store work", async () => {
    const getStoreGame = vi.fn();
    const service = createSteamGetGameService({
      steamData: {
        getStoreGame,
        getGameReviews: vi.fn(),
        getCurrentPlayers: vi.fn(),
        getDeckCompatibility: vi.fn(),
        getGameNews: vi.fn(),
        getGameAchievementSchema: vi.fn(),
        getGlobalAchievementPercentages: vi.fn(),
      },
    });

    await expect(
      service.execute(
        { appId: 620, facets: ["news", "news"] },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(getStoreGame).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND without optional fan-out when store identity is absent", async () => {
    const getGameReviews = vi.fn();
    const service = createSteamGetGameService({
      steamData: {
        getStoreGame: vi.fn().mockResolvedValue(undefined),
        getGameReviews,
        getCurrentPlayers: vi.fn(),
        getDeckCompatibility: vi.fn(),
        getGameNews: vi.fn(),
        getGameAchievementSchema: vi.fn(),
        getGlobalAchievementPercentages: vi.fn(),
      },
    });

    await expect(
      service.execute(
        { appId: 999_999_999, facets: ["reviews"] },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", retryable: false },
    });
    expect(getGameReviews).not.toHaveBeenCalled();
  });

  it("rejects an invalid app ID before any upstream work", async () => {
    const calls = {
      getStoreGame: vi.fn(),
      getGameReviews: vi.fn(),
      getCurrentPlayers: vi.fn(),
      getDeckCompatibility: vi.fn(),
      getGameNews: vi.fn(),
      getGameAchievementSchema: vi.fn(),
      getGlobalAchievementPercentages: vi.fn(),
    };
    const service = createSteamGetGameService({ steamData: calls });

    await expect(
      service.execute({ appId: 0 }, new AbortController().signal),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    for (const call of Object.values(calls)) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  it("preserves store details when optional reviews drift", async () => {
    const appId = parseAppId(620);
    const storeDetails = {
      appId,
      name: "Portal 2",
      developers: ["Valve"],
      publishers: ["Valve"],
      genres: ["Puzzle"],
      categories: [],
    };
    const service = createSteamGetGameService({
      steamData: {
        getStoreGame: vi.fn().mockResolvedValue(storeDetails),
        getGameReviews: vi
          .fn()
          .mockRejectedValue(new BestEffortSourceChangedError()),
        getCurrentPlayers: vi.fn().mockResolvedValue(42),
        getDeckCompatibility: vi.fn(),
        getGameNews: vi.fn(),
        getGameAchievementSchema: vi.fn(),
        getGlobalAchievementPercentages: vi.fn(),
      },
    });

    await expect(
      service.execute(
        { appId, facets: ["reviews", "current_players"] },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      ok: true,
      data: {
        appId,
        facets: { storeDetails, currentPlayers: 42 },
        unavailableFacets: [
          {
            facet: "reviews",
            sourceTier: "best_effort",
            code: "BEST_EFFORT_SOURCE_CHANGED",
          },
        ],
      },
      meta: {
        schema_version: "1",
        source_tiers: ["supported", "best_effort"],
        partial: true,
        warnings: ["Reviews are unavailable (BEST_EFFORT_SOURCE_CHANGED)."],
      },
    });
  });

  it("reports multiple unavailable best-effort facets in declared order", async () => {
    const appId = parseAppId(620);
    const storeDetails = {
      appId,
      name: "Portal 2",
      developers: ["Valve"],
      publishers: ["Valve"],
      genres: ["Puzzle"],
      categories: [],
    };
    const service = createSteamGetGameService({
      steamData: {
        getStoreGame: vi.fn().mockResolvedValue(storeDetails),
        getGameReviews: vi
          .fn()
          .mockRejectedValue(new OptionalSourceDisabledError()),
        getCurrentPlayers: vi.fn(),
        getDeckCompatibility: vi.fn().mockResolvedValue(undefined),
        getGameNews: vi.fn(),
        getGameAchievementSchema: vi.fn(),
        getGlobalAchievementPercentages: vi.fn(),
      },
    });

    await expect(
      service.execute(
        { appId, facets: ["deck_compatibility", "reviews"] },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        facets: { storeDetails },
        unavailableFacets: [
          {
            facet: "reviews",
            sourceTier: "best_effort",
            code: "UPSTREAM_UNAVAILABLE",
          },
          {
            facet: "deck_compatibility",
            sourceTier: "best_effort",
            code: "NOT_FOUND",
          },
        ],
      },
      meta: {
        partial: true,
        warnings: [
          "Reviews are unavailable (UPSTREAM_UNAVAILABLE).",
          "Steam Deck compatibility is unavailable (NOT_FOUND).",
        ],
      },
    });
  });

  it("marks an absent selected review summary as unavailable", async () => {
    const appId = parseAppId(620);
    const storeDetails = {
      appId,
      name: "Portal 2",
      developers: ["Valve"],
      publishers: ["Valve"],
      genres: ["Puzzle"],
      categories: [],
    };
    const service = createSteamGetGameService({
      steamData: {
        getStoreGame: vi.fn().mockResolvedValue(storeDetails),
        getGameReviews: vi.fn().mockResolvedValue(undefined),
        getCurrentPlayers: vi.fn(),
        getDeckCompatibility: vi.fn(),
        getGameNews: vi.fn(),
        getGameAchievementSchema: vi.fn(),
        getGlobalAchievementPercentages: vi.fn(),
      },
    });

    await expect(
      service.execute(
        { appId, facets: ["reviews"] },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        unavailableFacets: [
          {
            facet: "reviews",
            sourceTier: "best_effort",
            code: "NOT_FOUND",
          },
        ],
      },
      meta: {
        partial: true,
        warnings: ["Reviews are unavailable (NOT_FOUND)."],
      },
    });
  });

  it("does not downgrade optional-facet cancellation into a partial result", async () => {
    const appId = parseAppId(620);
    const cancellation = new Error("synthetic cancellation");
    const controller = new AbortController();
    controller.abort("sensitive reason");
    const service = createSteamGetGameService({
      steamData: {
        getStoreGame: vi.fn().mockResolvedValue({
          appId,
          name: "Portal 2",
          developers: [],
          publishers: [],
          genres: [],
          categories: [],
        }),
        getGameReviews: vi.fn().mockRejectedValue(cancellation),
        getCurrentPlayers: vi.fn(),
        getDeckCompatibility: vi.fn(),
        getGameNews: vi.fn(),
        getGameAchievementSchema: vi.fn(),
        getGlobalAchievementPercentages: vi.fn(),
      },
    });

    await expect(
      service.execute({ appId, facets: ["reviews"] }, controller.signal),
    ).rejects.toBe(cancellation);
  });

  it("propagates failure of a selected supported facet", async () => {
    const appId = parseAppId(620);
    const supportedFailure = new Error("supported news unavailable");
    const service = createSteamGetGameService({
      steamData: {
        getStoreGame: vi.fn().mockResolvedValue({
          appId,
          name: "Portal 2",
          developers: [],
          publishers: [],
          genres: [],
          categories: [],
        }),
        getGameReviews: vi.fn(),
        getCurrentPlayers: vi.fn(),
        getDeckCompatibility: vi.fn(),
        getGameNews: vi.fn().mockRejectedValue(supportedFailure),
        getGameAchievementSchema: vi.fn(),
        getGlobalAchievementPercentages: vi.fn(),
      },
    });

    await expect(
      service.execute(
        { appId, facets: ["news"] },
        new AbortController().signal,
      ),
    ).rejects.toBe(supportedFailure);
  });

  it("sanitizes an unexpected optional Deck failure", async () => {
    const appId = parseAppId(620);
    const service = createSteamGetGameService({
      steamData: {
        getStoreGame: vi.fn().mockResolvedValue({
          appId,
          name: "Portal 2",
          developers: [],
          publishers: [],
          genres: [],
          categories: [],
        }),
        getGameReviews: vi.fn(),
        getCurrentPlayers: vi.fn(),
        getDeckCompatibility: vi
          .fn()
          .mockRejectedValue(new Error("sensitive upstream detail")),
        getGameNews: vi.fn(),
        getGameAchievementSchema: vi.fn(),
        getGlobalAchievementPercentages: vi.fn(),
      },
    });

    const result = await service.execute(
      { appId, facets: ["deck_compatibility"] },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        unavailableFacets: [
          {
            facet: "deck_compatibility",
            code: "UPSTREAM_UNAVAILABLE",
          },
        ],
      },
      meta: {
        partial: true,
        warnings: [
          "Steam Deck compatibility is unavailable (UPSTREAM_UNAVAILABLE).",
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("sensitive upstream detail");
  });

  it("does not downgrade Deck cancellation into a partial result", async () => {
    const appId = parseAppId(620);
    const cancellation = new Error("synthetic Deck cancellation");
    const controller = new AbortController();
    controller.abort("sensitive reason");
    const service = createSteamGetGameService({
      steamData: {
        getStoreGame: vi.fn().mockResolvedValue({
          appId,
          name: "Portal 2",
          developers: [],
          publishers: [],
          genres: [],
          categories: [],
        }),
        getGameReviews: vi.fn(),
        getCurrentPlayers: vi.fn(),
        getDeckCompatibility: vi.fn().mockRejectedValue(cancellation),
        getGameNews: vi.fn(),
        getGameAchievementSchema: vi.fn(),
        getGlobalAchievementPercentages: vi.fn(),
      },
    });

    await expect(
      service.execute(
        { appId, facets: ["deck_compatibility"] },
        controller.signal,
      ),
    ).rejects.toBe(cancellation);
  });
});
