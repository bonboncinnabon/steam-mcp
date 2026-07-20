import { describe, expect, it, vi } from "vitest";

import type { AppId } from "../../../src/domain/app-id.js";
import { parseSteamId64 } from "../../../src/domain/steam-id.js";
import { createSteamAnalyzeLibraryService } from "../../../src/application/services/steam-analyze-library.js";
import { SteamIdentityResolutionError } from "../../../src/application/services/steam-identity-resolver.js";

describe("steam_analyze_library application service", () => {
  it("derives documented playtime, backlog, abandoned, and genre signals", async () => {
    const steamId = parseSteamId64("76561198000000000");
    const getStoreGame = vi.fn((appId: AppId) =>
      Promise.resolve({
        appId,
        name: `Game ${String(appId)}`,
        developers: [],
        publishers: [],
        categories: [],
        genres:
          appId === 5
            ? ["RPG"]
            : appId === 4
              ? ["Action", "RPG"]
              : appId === 3
                ? ["Puzzle"]
                : ["Action"],
      }),
    );
    const service = createSteamAnalyzeLibraryService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getOwnedGames: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [
            { appId: 1, name: "Backlog", playtimeMinutes: 0 },
            {
              appId: 2,
              name: "Abandoned",
              playtimeMinutes: 60,
              lastPlayedAt: "2025-12-01T00:00:00.000Z",
            },
            {
              appId: 3,
              name: "Two Hours",
              playtimeMinutes: 120,
              lastPlayedAt: "2026-07-01T00:00:00.000Z",
            },
            { appId: 4, name: "Ten Hours", playtimeMinutes: 600 },
            { appId: 5, name: "Fifty Hours", playtimeMinutes: 3_000 },
          ],
        }),
        getStoreGame,
      },
      clock: { now: () => new Date("2026-07-20T00:00:00.000Z") },
    });

    const result = await service.execute(
      { explicitUser: steamId },
      new AbortController().signal,
    );

    expect(result).toEqual({
      ok: true,
      data: {
        steamId,
        libraryGameCount: 5,
        totalPlaytimeMinutes: 3_780,
        playtimeDistribution: [
          { bucket: "unplayed", count: 1, totalMinutes: 0 },
          { bucket: "under_2_hours", count: 1, totalMinutes: 60 },
          { bucket: "2_to_under_10_hours", count: 1, totalMinutes: 120 },
          { bucket: "10_to_under_50_hours", count: 1, totalMinutes: 600 },
          { bucket: "50_hours_or_more", count: 1, totalMinutes: 3_000 },
        ],
        backlog: {
          count: 1,
          threshold: { recordedPlaytimeMinutes: 0 },
        },
        abandoned: {
          count: 1,
          insufficientLastPlayedEvidenceCount: 0,
          threshold: {
            minimumPlaytimeMinutes: 1,
            maximumPlaytimeMinutes: 119,
            inactiveDays: 180,
          },
        },
        frequentGenres: {
          status: "available",
          evidenceGameCount: 4,
          candidateGameCount: 4,
          maximumEvidenceGames: 20,
          minimumEvidenceGames: 3,
          scoring: "full_game_playtime_per_genre",
          genres: [
            { name: "RPG", gameCount: 2, playtimeMinutes: 3_600 },
            { name: "Action", gameCount: 2, playtimeMinutes: 660 },
            { name: "Puzzle", gameCount: 1, playtimeMinutes: 120 },
          ],
        },
      },
      meta: {
        schema_version: "1",
        source_tiers: ["supported", "best_effort", "derived"],
        partial: false,
        warnings: [],
      },
    });
    expect(getStoreGame).toHaveBeenCalledTimes(4);
  });

  it("marks empty-library genre evidence unavailable without store calls", async () => {
    const steamId = parseSteamId64("76561198000000001");
    const getStoreGame = vi.fn();
    const service = createSteamAnalyzeLibraryService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "linked" }),
      },
      steamData: {
        getOwnedGames: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [],
        }),
        getStoreGame,
      },
      clock: { now: () => new Date("2026-07-20T00:00:00.000Z") },
    });

    const result = await service.execute(
      { subject: "empty-library" },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        libraryGameCount: 0,
        totalPlaytimeMinutes: 0,
        backlog: { count: 0 },
        abandoned: { count: 0, insufficientLastPlayedEvidenceCount: 0 },
        frequentGenres: {
          status: "unavailable",
          reason: "insufficient_played_games",
          evidenceGameCount: 0,
          candidateGameCount: 0,
        },
      },
      meta: {
        source_tiers: ["supported", "derived"],
        partial: false,
        warnings: [],
      },
    });
    expect(getStoreGame).not.toHaveBeenCalled();
  });

  it("returns PROFILE_PRIVATE without enrichment", async () => {
    const steamId = parseSteamId64("76561198000000002");
    const getStoreGame = vi.fn();
    const service = createSteamAnalyzeLibraryService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "linked" }),
      },
      steamData: {
        getOwnedGames: vi.fn().mockResolvedValue({
          visibility: "private",
          items: [],
        }),
        getStoreGame,
      },
      clock: { now: vi.fn() },
    });

    await expect(
      service.execute({ subject: "private" }, new AbortController().signal),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "PROFILE_PRIVATE", retryable: false },
    });
    expect(getStoreGame).not.toHaveBeenCalled();
  });

  it("reports missing last-played evidence and partial genre enrichment", async () => {
    const steamId = parseSteamId64("76561198000000003");
    const getStoreGame = vi.fn((appId: AppId) => {
      if (appId === 4) {
        return Promise.reject(new Error("synthetic store failure"));
      }
      return Promise.resolve({
        appId,
        name: `Game ${String(appId)}`,
        developers: [],
        publishers: [],
        categories: [],
        genres: appId === 1 ? ["Action", "Action"] : ["Puzzle"],
      });
    });
    const service = createSteamAnalyzeLibraryService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getOwnedGames: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [1, 2, 3, 4].map((appId) => ({
            appId,
            name: `Game ${String(appId)}`,
            playtimeMinutes: appId * 10,
          })),
        }),
        getStoreGame,
      },
      clock: { now: () => new Date("2026-07-20T00:00:00.000Z") },
    });

    const result = await service.execute(
      { explicitUser: steamId },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        abandoned: { count: 0, insufficientLastPlayedEvidenceCount: 4 },
        frequentGenres: {
          status: "available",
          evidenceGameCount: 3,
          candidateGameCount: 4,
          genres: [
            { name: "Puzzle", gameCount: 2, playtimeMinutes: 50 },
            { name: "Action", gameCount: 1, playtimeMinutes: 10 },
          ],
        },
      },
      meta: {
        partial: true,
        warnings: ["Genre evidence was unavailable for 1 candidate games."],
      },
    });
  });

  it("marks genre analysis unavailable when fewer than three enrichments succeed", async () => {
    const steamId = parseSteamId64("76561198000000004");
    const service = createSteamAnalyzeLibraryService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getOwnedGames: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [1, 2, 3].map((appId) => ({
            appId,
            playtimeMinutes: appId * 10,
          })),
        }),
        getStoreGame: vi
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce({
            appId: 2,
            name: "Evidence",
            developers: [],
            publishers: [],
            categories: [],
            genres: ["Action"],
          })
          .mockRejectedValueOnce(new Error("synthetic store failure")),
      },
      clock: { now: () => new Date("2026-07-20T00:00:00.000Z") },
    });

    const result = await service.execute(
      { explicitUser: steamId },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        frequentGenres: {
          status: "unavailable",
          reason: "insufficient_genre_evidence",
          evidenceGameCount: 1,
          candidateGameCount: 3,
        },
      },
      meta: { partial: true },
    });
  });

  it("caps genre fan-out at twenty with at most four concurrent enrichments", async () => {
    const steamId = parseSteamId64("76561198000000005");
    let active = 0;
    let maximumActive = 0;
    const getStoreGame = vi.fn(async (appId: AppId) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return {
        appId,
        name: `Game ${String(appId)}`,
        developers: [],
        publishers: [],
        categories: [],
        genres: ["Action"],
      };
    });
    const service = createSteamAnalyzeLibraryService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getOwnedGames: vi.fn().mockResolvedValue({
          visibility: "public",
          items: Array.from({ length: 25 }, (_, index) => ({
            appId: index + 1,
            playtimeMinutes: index + 1,
          })),
        }),
        getStoreGame,
      },
      clock: { now: () => new Date("2026-07-20T00:00:00.000Z") },
    });

    const result = await service.execute(
      { explicitUser: steamId },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        frequentGenres: {
          status: "available",
          evidenceGameCount: 20,
          candidateGameCount: 20,
        },
      },
    });
    expect(getStoreGame).toHaveBeenCalledTimes(20);
    expect(maximumActive).toBe(4);
  });

  it("returns expected identity failures in the stable envelope", async () => {
    const service = createSteamAnalyzeLibraryService({
      identityResolver: {
        resolve: vi
          .fn()
          .mockRejectedValue(
            new SteamIdentityResolutionError(
              "IDENTITY_NOT_LINKED",
              "Provide a Steam user or link a default Steam identity",
            ),
          ),
      },
      steamData: { getOwnedGames: vi.fn(), getStoreGame: vi.fn() },
      clock: { now: vi.fn() },
    });

    await expect(
      service.execute({}, new AbortController().signal),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "IDENTITY_NOT_LINKED", retryable: false },
    });
  });

  it("does not misclassify an unexpected identity dependency failure", async () => {
    const dependencyFailure = new Error("synthetic identity dependency outage");
    const service = createSteamAnalyzeLibraryService({
      identityResolver: {
        resolve: vi.fn().mockRejectedValue(dependencyFailure),
      },
      steamData: { getOwnedGames: vi.fn(), getStoreGame: vi.fn() },
      clock: { now: vi.fn() },
    });

    await expect(
      service.execute({}, new AbortController().signal),
    ).rejects.toBe(dependencyFailure);
  });
});
