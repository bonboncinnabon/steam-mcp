import { describe, expect, it, vi } from "vitest";

import { parseSteamId64 } from "../../../src/domain/steam-id.js";
import { createSteamGetRecentActivityService } from "../../../src/application/services/steam-get-recent-activity.js";
import { SteamIdentityResolutionError } from "../../../src/application/services/steam-identity-resolver.js";

describe("steam_get_recent_activity application service", () => {
  it("returns bounded recent games with available current activity", async () => {
    const steamId = parseSteamId64("76561198000000000");
    const service = createSteamGetRecentActivityService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getRecentGames: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [
            { appId: 1, name: "One", playtimeMinutes: 100 },
            { appId: 2, name: "Two", playtimeMinutes: 200 },
            { appId: 3, name: "Three", playtimeMinutes: 300 },
          ],
        }),
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
          { appId: 1, name: "One", playtimeMinutes: 100 },
          { appId: 2, name: "Two", playtimeMinutes: 200 },
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
  });

  it("preserves a public empty recent collection and not-playing state", async () => {
    const steamId = parseSteamId64("76561198000000001");
    const service = createSteamGetRecentActivityService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getRecentGames: vi.fn().mockResolvedValue({
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
        getRecentGames: vi.fn().mockResolvedValue({
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
        getRecentGames: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [{ appId: 1, playtimeMinutes: 10 }],
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
    const getRecentGames = vi.fn();
    const getPlayers = vi.fn();
    const service = createSteamGetRecentActivityService({
      identityResolver: { resolve },
      steamData: { getRecentGames, getPlayers },
      maxItems: 20,
    });

    await expect(
      service.execute({ limit: 0 }, new AbortController().signal),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(getRecentGames).not.toHaveBeenCalled();
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
        getRecentGames: vi.fn().mockRejectedValue(requiredFailure),
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
              "Provide a Steam user, or configure STEAM_USER for local use",
            ),
          ),
      },
      steamData: { getRecentGames: vi.fn(), getPlayers: vi.fn() },
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
        steamData: { getRecentGames: vi.fn(), getPlayers: vi.fn() },
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
      steamData: { getRecentGames: vi.fn(), getPlayers: vi.fn() },
      maxItems: 20,
    });

    await expect(
      service.execute({ limit: 20 }, new AbortController().signal),
    ).rejects.toBe(dependencyFailure);
  });
});
