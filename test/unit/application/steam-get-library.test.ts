import { describe, expect, it, vi } from "vitest";

import { parseSteamId64 } from "../../../src/domain/steam-id.js";
import { createSteamGetLibraryService } from "../../../src/application/services/steam-get-library.js";
import { SteamIdentityResolutionError } from "../../../src/application/services/steam-identity-resolver.js";

describe("steam_get_library application service", () => {
  it("returns a deterministically sorted first page with an opaque cursor", async () => {
    const steamId = parseSteamId64("76561198000000000");
    const resolve = vi.fn().mockResolvedValue({ steamId, source: "explicit" });
    const getOwnedGames = vi.fn().mockResolvedValue({
      visibility: "public",
      items: [
        { appId: 10, name: "Low", playtimeMinutes: 10 },
        { appId: 30, name: "High", playtimeMinutes: 300 },
        { appId: 20, name: "Middle", playtimeMinutes: 100 },
      ],
    });
    const service = createSteamGetLibraryService({
      identityResolver: { resolve },
      steamData: { getOwnedGames },
      maxPageSize: 100,
    });
    const signal = new AbortController().signal;

    const result = await service.execute(
      {
        explicitUser: steamId,
        limit: 2,
        sortBy: "playtime",
        sortDirection: "desc",
      },
      signal,
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        steamId,
        totalCount: 3,
        games: [
          { appId: 30, name: "High", playtimeMinutes: 300 },
          { appId: 20, name: "Middle", playtimeMinutes: 100 },
        ],
      },
      meta: { source_tiers: ["supported"], partial: false },
    });
    expect(result).toHaveProperty("data.nextCursor");
    expect(result).not.toHaveProperty("data.offset");
    expect(resolve).toHaveBeenCalledWith({ explicitUser: steamId }, signal);
    expect(getOwnedGames).toHaveBeenCalledWith(steamId, signal);
  });

  it("rejects a malformed cursor before identity or Steam work", async () => {
    const resolve = vi.fn();
    const getOwnedGames = vi.fn();
    const service = createSteamGetLibraryService({
      identityResolver: { resolve },
      steamData: { getOwnedGames },
      maxPageSize: 100,
    });

    await expect(
      service.execute(
        { explicitUser: "vanity_name", limit: 20, cursor: "a" },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(getOwnedGames).not.toHaveBeenCalled();
  });

  it("continues without repeating games from the prior page", async () => {
    const steamId = parseSteamId64("76561198000000014");
    const service = createSteamGetLibraryService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getOwnedGames: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [
            { appId: 3, name: "Charlie", playtimeMinutes: 30 },
            { appId: 1, name: "Alpha", playtimeMinutes: 10 },
            { appId: 2, name: "Bravo", playtimeMinutes: 20 },
          ],
        }),
      },
      maxPageSize: 2,
    });
    const signal = new AbortController().signal;
    const first = await service.execute(
      { explicitUser: steamId, limit: 2, sortBy: "name" },
      signal,
    );
    if (!first.ok || first.data.nextCursor === undefined) {
      throw new Error("Expected a first library page with continuation");
    }

    const second = await service.execute(
      {
        explicitUser: steamId,
        limit: 2,
        sortBy: "name",
        cursor: first.data.nextCursor,
      },
      signal,
    );

    expect(first.data.games.map((game) => game.appId)).toEqual([1, 2]);
    expect(second).toMatchObject({
      ok: true,
      data: {
        totalCount: 3,
        games: [{ appId: 3 }],
      },
    });
    expect(second).not.toHaveProperty("data.nextCursor");
  });

  it("filters by name and played state before deterministic pagination", async () => {
    const steamId = parseSteamId64("76561198000000015");
    const service = createSteamGetLibraryService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getOwnedGames: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [
            { appId: 1, name: "Portal", playtimeMinutes: 0 },
            { appId: 2, name: "Portal 2", playtimeMinutes: 120 },
            { appId: 3, name: "Half-Life", playtimeMinutes: 300 },
            { appId: 4, playtimeMinutes: 10 },
          ],
        }),
      },
      maxPageSize: 20,
    });

    const result = await service.execute(
      {
        explicitUser: steamId,
        limit: 20,
        query: " PORTAL ",
        played: "played",
        sortBy: "playtime",
        sortDirection: "desc",
      },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        totalCount: 1,
        games: [{ appId: 2, name: "Portal 2", playtimeMinutes: 120 }],
      },
    });
  });

  it("returns PROFILE_PRIVATE instead of an empty library", async () => {
    const steamId = parseSteamId64("76561198000000016");
    const service = createSteamGetLibraryService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getOwnedGames: vi.fn().mockResolvedValue({
          visibility: "private",
          items: [],
        }),
      },
      maxPageSize: 100,
    });

    await expect(
      service.execute(
        { explicitUser: "private", limit: 20 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "PROFILE_PRIVATE", retryable: false },
    });
  });

  it("rejects an invalid limit before identity or Steam work", async () => {
    const resolve = vi.fn();
    const getOwnedGames = vi.fn();
    const service = createSteamGetLibraryService({
      identityResolver: { resolve },
      steamData: { getOwnedGames },
      maxPageSize: 100,
    });

    await expect(
      service.execute({ limit: 101 }, new AbortController().signal),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(getOwnedGames).not.toHaveBeenCalled();
  });

  it("rejects an invalid maximum page size at construction", () => {
    expect(() =>
      createSteamGetLibraryService({
        identityResolver: { resolve: vi.fn() },
        steamData: { getOwnedGames: vi.fn() },
        maxPageSize: 0,
      }),
    ).toThrow("Library maximum page size must be positive");
  });

  it("rejects an overlong filter before identity or Steam work", async () => {
    const resolve = vi.fn();
    const getOwnedGames = vi.fn();
    const service = createSteamGetLibraryService({
      identityResolver: { resolve },
      steamData: { getOwnedGames },
      maxPageSize: 100,
    });

    await expect(
      service.execute(
        { limit: 20, query: "x".repeat(101) },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(getOwnedGames).not.toHaveBeenCalled();
  });

  it("rejects a cursor reused with different filter or sort context", async () => {
    const steamId = parseSteamId64("76561198000000017");
    const getOwnedGames = vi.fn().mockResolvedValue({
      visibility: "public",
      items: [
        { appId: 1, name: "Alpha", playtimeMinutes: 10 },
        { appId: 2, name: "Bravo", playtimeMinutes: 20 },
      ],
    });
    const service = createSteamGetLibraryService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: { getOwnedGames },
      maxPageSize: 20,
    });
    const signal = new AbortController().signal;
    const first = await service.execute(
      { explicitUser: steamId, limit: 1, sortBy: "name" },
      signal,
    );
    if (!first.ok || first.data.nextCursor === undefined) {
      throw new Error("Expected a cursor-bound first page");
    }

    const result = await service.execute(
      {
        explicitUser: steamId,
        limit: 1,
        sortBy: "playtime",
        cursor: first.data.nextCursor,
      },
      signal,
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(getOwnedGames).toHaveBeenCalledOnce();
  });

  it("rejects a continuation offset beyond a changed library", async () => {
    const steamId = parseSteamId64("76561198000000018");
    const getOwnedGames = vi
      .fn()
      .mockResolvedValueOnce({
        visibility: "public",
        items: [
          { appId: 1, name: "Alpha", playtimeMinutes: 10 },
          { appId: 2, name: "Bravo", playtimeMinutes: 20 },
          { appId: 3, name: "Charlie", playtimeMinutes: 30 },
        ],
      })
      .mockResolvedValueOnce({ visibility: "public", items: [] });
    const service = createSteamGetLibraryService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: { getOwnedGames },
      maxPageSize: 20,
    });
    const signal = new AbortController().signal;
    const first = await service.execute(
      { explicitUser: steamId, limit: 2 },
      signal,
    );
    if (!first.ok || first.data.nextCursor === undefined) {
      throw new Error("Expected a cursor-bound first page");
    }

    await expect(
      service.execute(
        {
          explicitUser: steamId,
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

  it("returns an expected identity failure in the stable envelope", async () => {
    const getOwnedGames = vi.fn();
    const service = createSteamGetLibraryService({
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
      steamData: { getOwnedGames },
      maxPageSize: 20,
    });

    await expect(
      service.execute({ limit: 20 }, new AbortController().signal),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "IDENTITY_NOT_LINKED", retryable: false },
    });
    expect(getOwnedGames).not.toHaveBeenCalled();
  });

  it("does not misclassify an unexpected identity dependency failure", async () => {
    const dependencyFailure = new Error("synthetic identity dependency outage");
    const service = createSteamGetLibraryService({
      identityResolver: {
        resolve: vi.fn().mockRejectedValue(dependencyFailure),
      },
      steamData: { getOwnedGames: vi.fn() },
      maxPageSize: 20,
    });

    await expect(
      service.execute({ limit: 20 }, new AbortController().signal),
    ).rejects.toBe(dependencyFailure);
  });

  it("sorts unplayed games with deterministic app-ID tie breaking", async () => {
    const steamId = parseSteamId64("76561198000000019");
    const service = createSteamGetLibraryService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getOwnedGames: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [
            { appId: 2, name: "Second", playtimeMinutes: 0 },
            { appId: 1, name: "First", playtimeMinutes: 0 },
            {
              appId: 3,
              name: "Played",
              playtimeMinutes: 5,
              lastPlayedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      },
      maxPageSize: 20,
    });

    const result = await service.execute(
      {
        explicitUser: steamId,
        limit: 20,
        played: "unplayed",
        sortBy: "recent",
        sortDirection: "desc",
      },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      ok: true,
      data: { games: [{ appId: 1 }, { appId: 2 }] },
    });
  });
});
