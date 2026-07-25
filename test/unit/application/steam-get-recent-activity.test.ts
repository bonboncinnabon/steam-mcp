import { describe, expect, it, vi } from "vitest";

import { parseSteamId64 } from "../../../src/domain/steam-id.js";
import { createSteamGetRecentActivityService } from "../../../src/application/services/steam-get-recent-activity.js";
import { SteamIdentityResolutionError } from "../../../src/application/services/steam-identity-resolver.js";

describe("steam_get_recent_activity application service", () => {
  it("matches Steam's most-recently-played ordering from owned games", async () => {
    const steamId = parseSteamId64("76561198000000000");
    const getOwnedGames = vi.fn().mockResolvedValue({
      visibility: "public",
      items: [
        {
          appId: 2623190,
          name: "The Elder Scrolls IV: Oblivion Remastered",
          playtimeMinutes: 620,
          recentPlaytimeMinutes: 425,
          lastPlayedAt: "2026-07-17T10:51:21.000Z",
        },
        {
          appId: 289070,
          name: "Sid Meier's Civilization VI",
          playtimeMinutes: 6690,
          recentPlaytimeMinutes: 14,
          lastPlayedAt: "2026-07-20T15:48:12.000Z",
        },
        {
          appId: 2680010,
          name: "The First Berserker: Khazan",
          playtimeMinutes: 388,
          recentPlaytimeMinutes: 5,
          lastPlayedAt: "2026-07-19T10:56:57.000Z",
        },
      ],
    });
    const service = createSteamGetRecentActivityService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getOwnedGames,
        getPlayers: vi.fn().mockResolvedValue([
          {
            steamId,
            displayName: "Synthetic Player",
            profileUrl: "https://steamcommunity.com/profiles/synthetic",
            visibility: "public",
            onlineState: "online",
            currentAppId: 620,
          },
        ]),
      },
      maxItems: 20,
    });

    await expect(
      service.execute(
        { explicitUser: steamId, limit: 2 },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      ok: true,
      data: {
        steamId,
        recentGames: [
          {
            appId: 289070,
            name: "Sid Meier's Civilization VI",
            playtimeMinutes: 6690,
            recentPlaytimeMinutes: 14,
            lastPlayedAt: "2026-07-20T15:48:12.000Z",
          },
          {
            appId: 2680010,
            name: "The First Berserker: Khazan",
            playtimeMinutes: 388,
            recentPlaytimeMinutes: 5,
            lastPlayedAt: "2026-07-19T10:56:57.000Z",
          },
        ],
        currentActivity: {
          status: "playing",
          appId: 620,
          onlineState: "online",
        },
      },
      meta: {
        schema_version: "1",
        source_tiers: ["supported"],
        partial: false,
        warnings: [],
      },
    });
    expect(getOwnedGames).toHaveBeenCalledOnce();
  });

  it("excludes owned games that have never been played", async () => {
    const steamId = parseSteamId64("76561198000000000");
    const service = createSteamGetRecentActivityService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getOwnedGames: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [
            { appId: 1, name: "Never Played", playtimeMinutes: 0 },
            {
              appId: 2,
              name: "Played",
              playtimeMinutes: 10,
              lastPlayedAt: "2026-07-20T00:00:00.000Z",
            },
          ],
        }),
        getPlayers: vi.fn().mockResolvedValue([]),
      },
      maxItems: 20,
    });

    const result = await service.execute(
      { explicitUser: steamId, limit: 20 },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      ok: true,
      data: { recentGames: [{ appId: 2 }] },
    });
  });

  it("preserves a public empty recent collection and not-playing state", async () => {
    const steamId = parseSteamId64("76561198000000001");
    const service = createSteamGetRecentActivityService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getOwnedGames: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [],
        }),
        getPlayers: vi.fn().mockResolvedValue([
          {
            steamId,
            displayName: "Offline Player",
            profileUrl: "https://steamcommunity.com/profiles/synthetic",
            visibility: "public",
          },
        ]),
      },
      maxItems: 20,
    });

    await expect(
      service.execute(
        { explicitUser: "offline", limit: 20 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        recentGames: [],
        currentActivity: { status: "not_playing" },
      },
      meta: { partial: false, warnings: [] },
    });
  });

  it("returns PROFILE_PRIVATE rather than an empty recent collection", async () => {
    const steamId = parseSteamId64("76561198000000002");
    const service = createSteamGetRecentActivityService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getOwnedGames: vi.fn().mockResolvedValue({
          visibility: "private",
          items: [],
        }),
        getPlayers: vi.fn().mockResolvedValue([]),
      },
      maxItems: 20,
    });

    await expect(
      service.execute(
        { explicitUser: steamId, limit: 20 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "PROFILE_PRIVATE", retryable: false },
    });
  });

  it("preserves recent games when the optional current profile fails", async () => {
    const steamId = parseSteamId64("76561198000000003");
    const service = createSteamGetRecentActivityService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getOwnedGames: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [
            {
              appId: 1,
              playtimeMinutes: 10,
              lastPlayedAt: "2026-07-20T00:00:00.000Z",
            },
          ],
        }),
        getPlayers: vi.fn().mockRejectedValue(new Error("profile unavailable")),
      },
      maxItems: 20,
    });

    await expect(
      service.execute(
        { explicitUser: steamId, limit: 20 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        recentGames: [{ appId: 1 }],
        currentActivity: { status: "unavailable" },
      },
      meta: {
        partial: true,
        warnings: ["Current Steam activity is unavailable."],
      },
    });
  });

  it("rejects an invalid limit before identity or Steam work", async () => {
    const resolve = vi.fn();
    const getOwnedGames = vi.fn();
    const getPlayers = vi.fn();
    const service = createSteamGetRecentActivityService({
      identityResolver: { resolve },
      steamData: { getOwnedGames, getPlayers },
      maxItems: 20,
    });

    await expect(
      service.execute({ limit: 0 }, new AbortController().signal),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(getOwnedGames).not.toHaveBeenCalled();
    expect(getPlayers).not.toHaveBeenCalled();
  });

  it("propagates failure of the required recent-games facet", async () => {
    const steamId = parseSteamId64("76561198000000004");
    const requiredFailure = new Error("recent games unavailable");
    const service = createSteamGetRecentActivityService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getOwnedGames: vi.fn().mockRejectedValue(requiredFailure),
        getPlayers: vi.fn().mockResolvedValue([]),
      },
      maxItems: 20,
    });

    await expect(
      service.execute(
        { explicitUser: steamId, limit: 20 },
        new AbortController().signal,
      ),
    ).rejects.toBe(requiredFailure);
  });

  it("returns expected identity failures in the stable envelope", async () => {
    const service = createSteamGetRecentActivityService({
      identityResolver: {
        resolve: vi
          .fn()
          .mockRejectedValue(
            new SteamIdentityResolutionError(
              "IDENTITY_NOT_LINKED",
              "Provide a Steam user, or configure STEAM_USER",
            ),
          ),
      },
      steamData: { getOwnedGames: vi.fn(), getPlayers: vi.fn() },
      maxItems: 20,
    });

    await expect(
      service.execute({ limit: 20 }, new AbortController().signal),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "IDENTITY_NOT_LINKED", retryable: false },
    });
  });

  it("rejects an invalid maximum at construction", () => {
    expect(() =>
      createSteamGetRecentActivityService({
        identityResolver: { resolve: vi.fn() },
        steamData: { getOwnedGames: vi.fn(), getPlayers: vi.fn() },
        maxItems: 0,
      }),
    ).toThrow("Recent activity maximum must be positive");
  });

  it("does not misclassify an unexpected identity dependency failure", async () => {
    const dependencyFailure = new Error("synthetic identity dependency outage");
    const service = createSteamGetRecentActivityService({
      identityResolver: {
        resolve: vi.fn().mockRejectedValue(dependencyFailure),
      },
      steamData: { getOwnedGames: vi.fn(), getPlayers: vi.fn() },
      maxItems: 20,
    });

    await expect(
      service.execute({ limit: 20 }, new AbortController().signal),
    ).rejects.toBe(dependencyFailure);
  });
});
