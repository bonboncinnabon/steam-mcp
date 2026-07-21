import { describe, expect, it, vi } from "vitest";

import { parseAppId } from "../../../src/domain/app-id.js";
import { parseSteamId64 } from "../../../src/domain/steam-id.js";
import { createSteamGetAchievementsService } from "../../../src/application/services/steam-get-achievements.js";
import { SteamIdentityResolutionError } from "../../../src/application/services/steam-identity-resolver.js";

describe("steam_get_achievements application service", () => {
  it("returns enriched achievement progress with an opaque continuation", async () => {
    const steamId = parseSteamId64("76561198000000000");
    const appId = parseAppId(620);
    const service = createSteamGetAchievementsService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getPlayerAchievements: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [
            {
              apiName: "ACH_ONE",
              achieved: true,
              unlockedAt: "2026-01-01T00:00:00.000Z",
            },
            { apiName: "ACH_TWO", achieved: false },
            { apiName: "ACH_THREE", achieved: false },
          ],
        }),
        getGameAchievementSchema: vi.fn().mockResolvedValue([
          { apiName: "ACH_ONE", displayName: "One", hidden: false },
          { apiName: "ACH_TWO", displayName: "Two", hidden: false },
          { apiName: "ACH_THREE", displayName: "Three", hidden: true },
        ]),
        getGlobalAchievementPercentages: vi.fn().mockResolvedValue([
          { apiName: "ACH_ONE", globalPercent: 50 },
          { apiName: "ACH_TWO", globalPercent: 25 },
          { apiName: "ACH_THREE", globalPercent: 10 },
        ]),
      },
      maxPageSize: 100,
    });
    const signal = new AbortController().signal;

    const result = await service.execute(
      { explicitUser: steamId, appId, limit: 2, state: "all" },
      signal,
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        steamId,
        appId,
        totalCount: 3,
        achievements: [
          {
            apiName: "ACH_ONE",
            displayName: "One",
            achieved: true,
            unlockedAt: "2026-01-01T00:00:00.000Z",
            globalPercent: 50,
          },
          {
            apiName: "ACH_TWO",
            displayName: "Two",
            achieved: false,
            globalPercent: 25,
          },
        ],
      },
      meta: {
        source_tiers: ["supported"],
        partial: false,
        warnings: [],
      },
    });
    expect(result).toHaveProperty("data.nextCursor");
  });

  it("rejects a continuation when achievement data shrinks below its offset", async () => {
    const steamId = parseSteamId64("76561198000000001");
    const getPlayerAchievements = vi
      .fn()
      .mockResolvedValueOnce({
        visibility: "public",
        items: [
          { apiName: "ACH_ONE", achieved: true },
          { apiName: "ACH_TWO", achieved: false },
        ],
      })
      .mockResolvedValueOnce({ visibility: "public", items: [] });
    const service = createSteamGetAchievementsService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getPlayerAchievements,
        getGameAchievementSchema: vi.fn().mockResolvedValue([]),
        getGlobalAchievementPercentages: vi.fn().mockResolvedValue([]),
      },
      maxPageSize: 20,
    });
    const signal = new AbortController().signal;
    const first = await service.execute(
      { explicitUser: steamId, appId: 620, limit: 1 },
      signal,
    );
    if (!first.ok || first.data.nextCursor === undefined) {
      throw new Error("Expected a cursor-bound first achievement page");
    }

    const result = await service.execute(
      {
        explicitUser: steamId,
        appId: 620,
        limit: 1,
        cursor: first.data.nextCursor,
      },
      signal,
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
  });

  it("rejects a continuation offset beyond a changed nonempty achievement list", async () => {
    const steamId = parseSteamId64("76561198000000012");
    const getPlayerAchievements = vi
      .fn()
      .mockResolvedValueOnce({
        visibility: "public",
        items: [
          { apiName: "ACH_ONE", achieved: true },
          { apiName: "ACH_TWO", achieved: false },
          { apiName: "ACH_THREE", achieved: false },
        ],
      })
      .mockResolvedValueOnce({
        visibility: "public",
        items: [{ apiName: "ACH_ONE", achieved: true }],
      });
    const service = createSteamGetAchievementsService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getPlayerAchievements,
        getGameAchievementSchema: vi.fn().mockResolvedValue([]),
        getGlobalAchievementPercentages: vi.fn().mockResolvedValue([]),
      },
      maxPageSize: 20,
    });
    const signal = new AbortController().signal;
    const first = await service.execute(
      { explicitUser: steamId, appId: 620, limit: 2 },
      signal,
    );
    if (!first.ok || first.data.nextCursor === undefined) {
      throw new Error("Expected an achievement continuation offset");
    }

    await expect(
      service.execute(
        {
          explicitUser: steamId,
          appId: 620,
          limit: 2,
          cursor: first.data.nextCursor,
        },
        signal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
  });

  it("continues a filtered achievement page without repeating items", async () => {
    const steamId = parseSteamId64("76561198000000002");
    const getPlayerAchievements = vi.fn().mockResolvedValue({
      visibility: "public",
      items: [
        { apiName: "LOCKED_ONE", achieved: false },
        { apiName: "UNLOCKED", achieved: true },
        { apiName: "LOCKED_TWO", achieved: false },
      ],
    });
    const service = createSteamGetAchievementsService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getPlayerAchievements,
        getGameAchievementSchema: vi.fn().mockResolvedValue([]),
        getGlobalAchievementPercentages: vi.fn().mockResolvedValue([]),
      },
      maxPageSize: 1,
    });
    const signal = new AbortController().signal;
    const first = await service.execute(
      { explicitUser: steamId, appId: 620, limit: 1, state: "locked" },
      signal,
    );
    if (!first.ok || first.data.nextCursor === undefined) {
      throw new Error("Expected a filtered achievement continuation");
    }

    const second = await service.execute(
      {
        explicitUser: steamId,
        appId: 620,
        limit: 1,
        state: "locked",
        cursor: first.data.nextCursor,
      },
      signal,
    );

    expect(first.data.achievements).toEqual([
      { apiName: "LOCKED_ONE", achieved: false },
    ]);
    expect(second).toMatchObject({
      ok: true,
      data: {
        totalCount: 2,
        achievements: [{ apiName: "LOCKED_TWO", achieved: false }],
      },
    });
    expect(second).not.toHaveProperty("data.nextCursor");
  });

  it("rejects a malformed cursor before identity or Steam work", async () => {
    const resolve = vi.fn();
    const getPlayerAchievements = vi.fn();
    const service = createSteamGetAchievementsService({
      identityResolver: { resolve },
      steamData: {
        getPlayerAchievements,
        getGameAchievementSchema: vi.fn(),
        getGlobalAchievementPercentages: vi.fn(),
      },
      maxPageSize: 20,
    });

    await expect(
      service.execute(
        { appId: 620, limit: 20, cursor: "a" },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(getPlayerAchievements).not.toHaveBeenCalled();
  });

  it.each([
    { name: "app ID", input: { appId: 0, limit: 20 } },
    { name: "limit", input: { appId: 620, limit: 21 } },
    {
      name: "state",
      input: { appId: 620, limit: 20, state: "completed" as never },
    },
  ])(
    "rejects an invalid $name before identity or Steam work",
    async ({ input }) => {
      const resolve = vi.fn();
      const getPlayerAchievements = vi.fn();
      const service = createSteamGetAchievementsService({
        identityResolver: { resolve },
        steamData: {
          getPlayerAchievements,
          getGameAchievementSchema: vi.fn(),
          getGlobalAchievementPercentages: vi.fn(),
        },
        maxPageSize: 20,
      });

      await expect(
        service.execute(input, new AbortController().signal),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_INPUT", retryable: false },
      });
      expect(resolve).not.toHaveBeenCalled();
      expect(getPlayerAchievements).not.toHaveBeenCalled();
    },
  );

  it("returns PROFILE_PRIVATE without requesting optional enrichment", async () => {
    const steamId = parseSteamId64("76561198000000003");
    const getGameAchievementSchema = vi.fn();
    const getGlobalAchievementPercentages = vi.fn();
    const service = createSteamGetAchievementsService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getPlayerAchievements: vi.fn().mockResolvedValue({
          visibility: "private",
          items: [],
        }),
        getGameAchievementSchema,
        getGlobalAchievementPercentages,
      },
      maxPageSize: 20,
    });

    await expect(
      service.execute(
        { explicitUser: "private-user", appId: 620, limit: 20 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "PROFILE_PRIVATE", retryable: false },
    });
    expect(getGameAchievementSchema).not.toHaveBeenCalled();
    expect(getGlobalAchievementPercentages).not.toHaveBeenCalled();
  });

  it("returns an explained empty success when the game has no achievements", async () => {
    const steamId = parseSteamId64("76561198000000004");
    const getGameAchievementSchema = vi.fn();
    const getGlobalAchievementPercentages = vi.fn();
    const service = createSteamGetAchievementsService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getPlayerAchievements: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [],
        }),
        getGameAchievementSchema,
        getGlobalAchievementPercentages,
      },
      maxPageSize: 20,
    });

    await expect(
      service.execute(
        { explicitUser: steamId, appId: 620, limit: 20 },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      ok: true,
      data: {
        steamId,
        appId: parseAppId(620),
        achievements: [],
        totalCount: 0,
      },
      meta: {
        schema_version: "1",
        source_tiers: ["supported"],
        partial: false,
        warnings: ["This game exposes no achievements."],
      },
    });
    expect(getGameAchievementSchema).not.toHaveBeenCalled();
    expect(getGlobalAchievementPercentages).not.toHaveBeenCalled();
  });

  it("preserves rarity when optional display metadata is unavailable", async () => {
    const steamId = parseSteamId64("76561198000000005");
    const service = createSteamGetAchievementsService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getPlayerAchievements: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [{ apiName: "ACH_ONE", achieved: true }],
        }),
        getGameAchievementSchema: vi
          .fn()
          .mockRejectedValue(new Error("schema unavailable")),
        getGlobalAchievementPercentages: vi
          .fn()
          .mockResolvedValue([{ apiName: "ACH_ONE", globalPercent: 12.5 }]),
      },
      maxPageSize: 20,
    });

    await expect(
      service.execute(
        { explicitUser: steamId, appId: 620, limit: 20 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        achievements: [
          { apiName: "ACH_ONE", achieved: true, globalPercent: 12.5 },
        ],
      },
      meta: {
        partial: true,
        warnings: ["Achievement display metadata is unavailable."],
      },
    });
  });

  it("preserves display metadata when optional rarity is unavailable", async () => {
    const steamId = parseSteamId64("76561198000000006");
    const service = createSteamGetAchievementsService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getPlayerAchievements: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [{ apiName: "ACH_ONE", achieved: false }],
        }),
        getGameAchievementSchema: vi.fn().mockResolvedValue([
          {
            apiName: "ACH_ONE",
            displayName: "Achievement One",
            description: "Do the thing.",
            hidden: false,
          },
        ]),
        getGlobalAchievementPercentages: vi
          .fn()
          .mockRejectedValue(new Error("rarity unavailable")),
      },
      maxPageSize: 20,
    });

    await expect(
      service.execute(
        { explicitUser: steamId, appId: 620, limit: 20 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        achievements: [
          {
            apiName: "ACH_ONE",
            displayName: "Achievement One",
            description: "Do the thing.",
            achieved: false,
          },
        ],
      },
      meta: {
        partial: true,
        warnings: ["Global achievement rarity is unavailable."],
      },
    });
  });

  it("binds continuation cursors to the requested game and state", async () => {
    const steamId = parseSteamId64("76561198000000007");
    const getPlayerAchievements = vi.fn().mockResolvedValue({
      visibility: "public",
      items: [
        { apiName: "ACH_ONE", achieved: false },
        { apiName: "ACH_TWO", achieved: false },
      ],
    });
    const service = createSteamGetAchievementsService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getPlayerAchievements,
        getGameAchievementSchema: vi.fn().mockResolvedValue([]),
        getGlobalAchievementPercentages: vi.fn().mockResolvedValue([]),
      },
      maxPageSize: 20,
    });
    const signal = new AbortController().signal;
    const first = await service.execute(
      { explicitUser: steamId, appId: 620, limit: 1, state: "locked" },
      signal,
    );
    if (!first.ok || first.data.nextCursor === undefined) {
      throw new Error("Expected a cursor-bound achievement page");
    }

    const wrongGame = await service.execute(
      {
        explicitUser: steamId,
        appId: 400,
        limit: 1,
        state: "locked",
        cursor: first.data.nextCursor,
      },
      signal,
    );
    const wrongState = await service.execute(
      {
        explicitUser: steamId,
        appId: 620,
        limit: 1,
        state: "all",
        cursor: first.data.nextCursor,
      },
      signal,
    );

    expect(wrongGame).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(wrongState).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(getPlayerAchievements).toHaveBeenCalledOnce();
  });

  it("binds continuation cursors to the resolved Steam user", async () => {
    const firstSteamId = parseSteamId64("76561198000000008");
    const secondSteamId = parseSteamId64("76561198000000009");
    const getPlayerAchievements = vi.fn().mockResolvedValue({
      visibility: "public",
      items: [
        { apiName: "ACH_ONE", achieved: false },
        { apiName: "ACH_TWO", achieved: false },
      ],
    });
    const service = createSteamGetAchievementsService({
      identityResolver: {
        resolve: vi
          .fn()
          .mockResolvedValueOnce({ steamId: firstSteamId, source: "explicit" })
          .mockResolvedValueOnce({
            steamId: secondSteamId,
            source: "explicit",
          }),
      },
      steamData: {
        getPlayerAchievements,
        getGameAchievementSchema: vi.fn().mockResolvedValue([]),
        getGlobalAchievementPercentages: vi.fn().mockResolvedValue([]),
      },
      maxPageSize: 20,
    });
    const signal = new AbortController().signal;
    const first = await service.execute(
      { explicitUser: firstSteamId, appId: 620, limit: 1 },
      signal,
    );
    if (!first.ok || first.data.nextCursor === undefined) {
      throw new Error("Expected a user-bound achievement page");
    }

    await expect(
      service.execute(
        {
          explicitUser: secondSteamId,
          appId: 620,
          limit: 1,
          cursor: first.data.nextCursor,
        },
        signal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(getPlayerAchievements).toHaveBeenCalledOnce();
  });

  it("returns an expected identity failure in the stable envelope", async () => {
    const getPlayerAchievements = vi.fn();
    const service = createSteamGetAchievementsService({
      identityResolver: {
        resolve: vi
          .fn()
          .mockRejectedValue(
            new SteamIdentityResolutionError(
              "IDENTITY_NOT_LINKED",
              "Provide a Steam user, or configure STEAM_USER for local use",
            ),
          ),
      },
      steamData: {
        getPlayerAchievements,
        getGameAchievementSchema: vi.fn(),
        getGlobalAchievementPercentages: vi.fn(),
      },
      maxPageSize: 20,
    });

    await expect(
      service.execute({ appId: 620, limit: 20 }, new AbortController().signal),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "IDENTITY_NOT_LINKED", retryable: false },
    });
    expect(getPlayerAchievements).not.toHaveBeenCalled();
  });

  it("does not misclassify an unexpected identity dependency failure", async () => {
    const dependencyFailure = new Error("synthetic identity dependency outage");
    const service = createSteamGetAchievementsService({
      identityResolver: {
        resolve: vi.fn().mockRejectedValue(dependencyFailure),
      },
      steamData: {
        getPlayerAchievements: vi.fn(),
        getGameAchievementSchema: vi.fn(),
        getGlobalAchievementPercentages: vi.fn(),
      },
      maxPageSize: 20,
    });

    await expect(
      service.execute({ appId: 620, limit: 20 }, new AbortController().signal),
    ).rejects.toBe(dependencyFailure);
  });

  it("rejects an invalid maximum page size at construction", () => {
    expect(() =>
      createSteamGetAchievementsService({
        identityResolver: { resolve: vi.fn() },
        steamData: {
          getPlayerAchievements: vi.fn(),
          getGameAchievementSchema: vi.fn(),
          getGlobalAchievementPercentages: vi.fn(),
        },
        maxPageSize: 0,
      }),
    ).toThrow("Achievement maximum page size must be positive");
  });

  it("propagates failure of the required achievement-progress facet", async () => {
    const steamId = parseSteamId64("76561198000000010");
    const requiredFailure = new Error("achievement progress unavailable");
    const service = createSteamGetAchievementsService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getPlayerAchievements: vi.fn().mockRejectedValue(requiredFailure),
        getGameAchievementSchema: vi.fn(),
        getGlobalAchievementPercentages: vi.fn(),
      },
      maxPageSize: 20,
    });

    await expect(
      service.execute(
        { explicitUser: steamId, appId: 620, limit: 20 },
        new AbortController().signal,
      ),
    ).rejects.toBe(requiredFailure);
  });

  it("returns bare progress with both warnings when all enrichment fails", async () => {
    const steamId = parseSteamId64("76561198000000011");
    const service = createSteamGetAchievementsService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getPlayerAchievements: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [{ apiName: "ACH_ONE", achieved: false }],
        }),
        getGameAchievementSchema: vi
          .fn()
          .mockRejectedValue(new Error("schema unavailable")),
        getGlobalAchievementPercentages: vi
          .fn()
          .mockRejectedValue(new Error("rarity unavailable")),
      },
      maxPageSize: 20,
    });

    await expect(
      service.execute(
        { explicitUser: steamId, appId: 620, limit: 20 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        achievements: [{ apiName: "ACH_ONE", achieved: false }],
      },
      meta: {
        partial: true,
        warnings: [
          "Achievement display metadata is unavailable.",
          "Global achievement rarity is unavailable.",
        ],
      },
    });
  });
});
