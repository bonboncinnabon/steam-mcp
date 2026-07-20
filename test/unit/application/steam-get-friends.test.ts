import { describe, expect, it, vi } from "vitest";

import { createSteamGetFriendsService } from "../../../src/application/services/steam-get-friends.js";
import { SteamIdentityResolutionError } from "../../../src/application/services/steam-identity-resolver.js";
import { parseSteamId64 } from "../../../src/domain/steam-id.js";

describe("steam_get_friends application service", () => {
  it("returns a bounded friend page with capped presence enrichment", async () => {
    const ownerId = parseSteamId64("76561198000000000");
    const firstId = parseSteamId64("76561198000000001");
    const secondId = parseSteamId64("76561198000000002");
    const getPlayers = vi.fn().mockResolvedValue([
      {
        steamId: firstId,
        displayName: "First",
        profileUrl: `https://steamcommunity.com/profiles/${firstId}/`,
        visibility: "public",
        onlineState: "online",
      },
    ]);
    const service = createSteamGetFriendsService({
      identityResolver: {
        resolve: vi
          .fn()
          .mockResolvedValue({ steamId: ownerId, source: "explicit" }),
      },
      steamData: {
        getFriends: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [{ steamId: firstId }, { steamId: secondId }],
        }),
        getPlayers,
      },
      maxPageSize: 100,
      maxPresenceProfiles: 1,
    });
    const signal = new AbortController().signal;

    await expect(
      service.execute(
        {
          explicitUser: ownerId,
          limit: 2,
          includePresence: true,
        },
        signal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        steamId: ownerId,
        totalCount: 2,
        friends: [
          {
            relationship: { steamId: firstId },
            enrichment: {
              status: "available",
              profile: { steamId: firstId, onlineState: "online" },
            },
          },
          {
            relationship: { steamId: secondId },
            enrichment: { status: "fan_out_limited" },
          },
        ],
      },
      meta: { source_tiers: ["supported"], partial: false, warnings: [] },
    });
    expect(getPlayers).toHaveBeenCalledWith([firstId], signal);
    expect(getPlayers).toHaveBeenCalledOnce();
  });

  it("returns PROFILE_PRIVATE instead of an empty friend page", async () => {
    const ownerId = parseSteamId64("76561198000000010");
    const getPlayers = vi.fn();
    const service = createSteamGetFriendsService({
      identityResolver: {
        resolve: vi
          .fn()
          .mockResolvedValue({ steamId: ownerId, source: "explicit" }),
      },
      steamData: {
        getFriends: vi.fn().mockResolvedValue({
          visibility: "private",
          items: [],
        }),
        getPlayers,
      },
      maxPageSize: 100,
      maxPresenceProfiles: 20,
    });

    await expect(
      service.execute(
        { explicitUser: ownerId, limit: 20, includePresence: true },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "PROFILE_PRIVATE", retryable: false },
    });
    expect(getPlayers).not.toHaveBeenCalled();
  });

  it("returns an opaque continuation for a bounded friend page", async () => {
    const ownerId = parseSteamId64("76561198000000020");
    const firstId = parseSteamId64("76561198000000021");
    const secondId = parseSteamId64("76561198000000022");
    const getPlayers = vi.fn();
    const service = createSteamGetFriendsService({
      identityResolver: {
        resolve: vi
          .fn()
          .mockResolvedValue({ steamId: ownerId, source: "explicit" }),
      },
      steamData: {
        getFriends: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [{ steamId: firstId }, { steamId: secondId }],
        }),
        getPlayers,
      },
      maxPageSize: 100,
      maxPresenceProfiles: 20,
    });

    const result = await service.execute(
      { explicitUser: ownerId, limit: 1 },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        steamId: ownerId,
        totalCount: 2,
        friends: [{ steamId: firstId }],
      },
    });
    expect(result).toHaveProperty("data.nextCursor");
    expect(result).not.toHaveProperty("data.offset");
    expect(getPlayers).not.toHaveBeenCalled();
  });

  it("continues without repeating friends from the prior page", async () => {
    const ownerId = parseSteamId64("76561198000000030");
    const friendIds = [
      parseSteamId64("76561198000000031"),
      parseSteamId64("76561198000000032"),
      parseSteamId64("76561198000000033"),
    ];
    const service = createSteamGetFriendsService({
      identityResolver: {
        resolve: vi
          .fn()
          .mockResolvedValue({ steamId: ownerId, source: "explicit" }),
      },
      steamData: {
        getFriends: vi.fn().mockResolvedValue({
          visibility: "public",
          items: friendIds.map((steamId) => ({ steamId })),
        }),
        getPlayers: vi.fn(),
      },
      maxPageSize: 2,
      maxPresenceProfiles: 2,
    });
    const signal = new AbortController().signal;
    const first = await service.execute(
      { explicitUser: ownerId, limit: 2 },
      signal,
    );
    if (!first.ok || first.data.nextCursor === undefined) {
      throw new Error("Expected a first friend page with continuation");
    }

    const second = await service.execute(
      {
        explicitUser: ownerId,
        limit: 2,
        cursor: first.data.nextCursor,
      },
      signal,
    );

    expect(first.data.friends).toEqual([
      { steamId: friendIds[0] },
      { steamId: friendIds[1] },
    ]);
    expect(second).toMatchObject({
      ok: true,
      data: { totalCount: 3, friends: [{ steamId: friendIds[2] }] },
    });
    expect(second).not.toHaveProperty("data.nextCursor");
  });

  it("rejects an invalid limit before identity or Steam work", async () => {
    const resolve = vi.fn();
    const getFriends = vi.fn();
    const service = createSteamGetFriendsService({
      identityResolver: { resolve },
      steamData: { getFriends, getPlayers: vi.fn() },
      maxPageSize: 20,
      maxPresenceProfiles: 10,
    });

    await expect(
      service.execute({ limit: 21 }, new AbortController().signal),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(getFriends).not.toHaveBeenCalled();
  });

  it("preserves the friend page when optional presence enrichment fails", async () => {
    const ownerId = parseSteamId64("76561198000000040");
    const friendId = parseSteamId64("76561198000000041");
    const limitedFriendId = parseSteamId64("76561198000000042");
    const service = createSteamGetFriendsService({
      identityResolver: {
        resolve: vi
          .fn()
          .mockResolvedValue({ steamId: ownerId, source: "explicit" }),
      },
      steamData: {
        getFriends: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [{ steamId: friendId }, { steamId: limitedFriendId }],
        }),
        getPlayers: vi
          .fn()
          .mockRejectedValue(new Error("presence unavailable")),
      },
      maxPageSize: 20,
      maxPresenceProfiles: 1,
    });

    await expect(
      service.execute(
        { explicitUser: ownerId, limit: 20, includePresence: true },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        friends: [
          {
            relationship: { steamId: friendId },
            enrichment: { status: "unavailable" },
          },
          {
            relationship: { steamId: limitedFriendId },
            enrichment: { status: "fan_out_limited" },
          },
        ],
      },
      meta: {
        partial: true,
        warnings: ["Friend presence is unavailable."],
      },
    });
  });

  it("rejects a continuation offset beyond a changed friend list", async () => {
    const ownerId = parseSteamId64("76561198000000050");
    const friendIds = [
      parseSteamId64("76561198000000051"),
      parseSteamId64("76561198000000052"),
      parseSteamId64("76561198000000053"),
    ];
    const getFriends = vi
      .fn()
      .mockResolvedValueOnce({
        visibility: "public",
        items: friendIds.map((steamId) => ({ steamId })),
      })
      .mockResolvedValueOnce({
        visibility: "public",
        items: [{ steamId: friendIds[0] }],
      });
    const service = createSteamGetFriendsService({
      identityResolver: {
        resolve: vi
          .fn()
          .mockResolvedValue({ steamId: ownerId, source: "explicit" }),
      },
      steamData: { getFriends, getPlayers: vi.fn() },
      maxPageSize: 20,
      maxPresenceProfiles: 10,
    });
    const signal = new AbortController().signal;
    const first = await service.execute(
      { explicitUser: ownerId, limit: 2 },
      signal,
    );
    if (!first.ok || first.data.nextCursor === undefined) {
      throw new Error("Expected a friend continuation offset");
    }

    await expect(
      service.execute(
        {
          explicitUser: ownerId,
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
    const getFriends = vi.fn();
    const service = createSteamGetFriendsService({
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
      steamData: { getFriends, getPlayers: vi.fn() },
      maxPageSize: 20,
      maxPresenceProfiles: 10,
    });

    await expect(
      service.execute({ limit: 20 }, new AbortController().signal),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "IDENTITY_NOT_LINKED", retryable: false },
    });
    expect(getFriends).not.toHaveBeenCalled();
  });

  it.each([
    { maxPageSize: 0, maxPresenceProfiles: 10 },
    { maxPageSize: 20, maxPresenceProfiles: 0 },
    { maxPageSize: 20, maxPresenceProfiles: 101 },
  ])(
    "rejects invalid pagination or presence bounds at construction",
    ({ maxPageSize, maxPresenceProfiles }) => {
      expect(() =>
        createSteamGetFriendsService({
          identityResolver: { resolve: vi.fn() },
          steamData: { getFriends: vi.fn(), getPlayers: vi.fn() },
          maxPageSize,
          maxPresenceProfiles,
        }),
      ).toThrow();
    },
  );

  it("does not downgrade cancellation into missing presence", async () => {
    const ownerId = parseSteamId64("76561198000000060");
    const friendId = parseSteamId64("76561198000000061");
    const getPlayers = vi.fn();
    const service = createSteamGetFriendsService({
      identityResolver: {
        resolve: vi
          .fn()
          .mockResolvedValue({ steamId: ownerId, source: "explicit" }),
      },
      steamData: {
        getFriends: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [{ steamId: friendId }],
        }),
        getPlayers,
      },
      maxPageSize: 20,
      maxPresenceProfiles: 10,
    });
    const controller = new AbortController();
    controller.abort("sensitive cancellation reason");

    await expect(
      service.execute(
        { explicitUser: ownerId, limit: 20, includePresence: true },
        controller.signal,
      ),
    ).rejects.toThrow("Steam friend enrichment cancelled");
    expect(getPlayers).not.toHaveBeenCalled();
  });

  it("preserves a public empty friend list without an enrichment call", async () => {
    const ownerId = parseSteamId64("76561198000000070");
    const getPlayers = vi.fn();
    const service = createSteamGetFriendsService({
      identityResolver: {
        resolve: vi
          .fn()
          .mockResolvedValue({ steamId: ownerId, source: "explicit" }),
      },
      steamData: {
        getFriends: vi.fn().mockResolvedValue({
          visibility: "public",
          items: [],
        }),
        getPlayers,
      },
      maxPageSize: 20,
      maxPresenceProfiles: 10,
    });

    await expect(
      service.execute(
        { explicitUser: ownerId, limit: 20, includePresence: true },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { totalCount: 0, friends: [] },
      meta: { partial: false, warnings: [] },
    });
    expect(getPlayers).not.toHaveBeenCalled();
  });

  it("rejects a malformed cursor before identity or Steam work", async () => {
    const resolve = vi.fn();
    const getFriends = vi.fn();
    const service = createSteamGetFriendsService({
      identityResolver: { resolve },
      steamData: { getFriends, getPlayers: vi.fn() },
      maxPageSize: 20,
      maxPresenceProfiles: 10,
    });

    await expect(
      service.execute({ limit: 20, cursor: "a" }, new AbortController().signal),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(getFriends).not.toHaveBeenCalled();
  });

  it("does not misclassify an unexpected identity dependency failure", async () => {
    const dependencyFailure = new Error("synthetic identity dependency outage");
    const service = createSteamGetFriendsService({
      identityResolver: {
        resolve: vi.fn().mockRejectedValue(dependencyFailure),
      },
      steamData: { getFriends: vi.fn(), getPlayers: vi.fn() },
      maxPageSize: 20,
      maxPresenceProfiles: 10,
    });

    await expect(
      service.execute({ limit: 20 }, new AbortController().signal),
    ).rejects.toBe(dependencyFailure);
  });

  it("propagates failure of the required friend-list facet", async () => {
    const ownerId = parseSteamId64("76561198000000080");
    const requiredFailure = new Error("friend list unavailable");
    const service = createSteamGetFriendsService({
      identityResolver: {
        resolve: vi
          .fn()
          .mockResolvedValue({ steamId: ownerId, source: "explicit" }),
      },
      steamData: {
        getFriends: vi.fn().mockRejectedValue(requiredFailure),
        getPlayers: vi.fn(),
      },
      maxPageSize: 20,
      maxPresenceProfiles: 10,
    });

    await expect(
      service.execute(
        { explicitUser: ownerId, limit: 20 },
        new AbortController().signal,
      ),
    ).rejects.toBe(requiredFailure);
  });

  it("binds continuation cursors to the resolved user and presence mode", async () => {
    const ownerId = parseSteamId64("76561198000000090");
    const otherId = parseSteamId64("76561198000000091");
    const friendIds = [
      parseSteamId64("76561198000000092"),
      parseSteamId64("76561198000000093"),
    ];
    const getFriends = vi.fn().mockResolvedValue({
      visibility: "public",
      items: friendIds.map((steamId) => ({ steamId })),
    });
    const service = createSteamGetFriendsService({
      identityResolver: {
        resolve: vi
          .fn()
          .mockResolvedValueOnce({ steamId: ownerId, source: "explicit" })
          .mockResolvedValueOnce({ steamId: ownerId, source: "explicit" })
          .mockResolvedValueOnce({ steamId: otherId, source: "explicit" }),
      },
      steamData: { getFriends, getPlayers: vi.fn() },
      maxPageSize: 20,
      maxPresenceProfiles: 10,
    });
    const signal = new AbortController().signal;
    const first = await service.execute(
      { explicitUser: ownerId, limit: 1 },
      signal,
    );
    if (!first.ok || first.data.nextCursor === undefined) {
      throw new Error("Expected a context-bound friend cursor");
    }

    const wrongPresence = await service.execute(
      {
        explicitUser: ownerId,
        limit: 1,
        includePresence: true,
        cursor: first.data.nextCursor,
      },
      signal,
    );
    const wrongUser = await service.execute(
      {
        explicitUser: otherId,
        limit: 1,
        cursor: first.data.nextCursor,
      },
      signal,
    );

    expect(wrongPresence).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(wrongUser).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(getFriends).toHaveBeenCalledOnce();
  });
});
