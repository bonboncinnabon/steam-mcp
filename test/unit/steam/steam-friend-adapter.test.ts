import { describe, expect, it, vi } from "vitest";

import { parseSteamId64 } from "../../../src/domain/steam-id.js";
import {
  createSteamFriendAdapter,
  enrichFriendProfiles,
  type SteamPlayerBatchFetcher,
  type SteamFriendHttpExecutor,
} from "../../../src/steam/adapters/steam-friend-adapter.js";

describe("Steam friend adapter", () => {
  it("normalizes a public friend list in upstream order", async () => {
    const execute = vi.fn<SteamFriendHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          friendslist: {
            friends: [
              {
                steamid: "76561198000000001",
                relationship: "friend",
                friend_since: 1_700_000_000,
              },
              {
                steamid: "76561198000000002",
                relationship: "friend",
                friend_since: 0,
              },
            ],
          },
        }),
      ),
      finalUrl: "https://api.steampowered.com/ISteamUser/GetFriendList/v1/",
    });
    const adapter = createSteamFriendAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });
    const signal = new AbortController().signal;

    await expect(
      adapter.getFriends(parseSteamId64("76561198000000000"), signal),
    ).resolves.toEqual({
      visibility: "public",
      items: [
        {
          steamId: "76561198000000001",
          friendsSince: new Date(1_700_000_000 * 1_000).toISOString(),
        },
        { steamId: "76561198000000002" },
      ],
    });
    const [request, receivedSignal] = execute.mock.calls[0] ?? [];
    expect(request).toMatchObject({
      url: "https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=synthetic-api-key&steamid=76561198000000000&relationship=friend",
      acceptedErrorStatuses: [401],
    });
    expect(receivedSignal).toBe(signal);
  });

  it("maps only the endpoint-specific private-list status to private", async () => {
    const execute = vi.fn<SteamFriendHttpExecutor>().mockResolvedValue({
      status: 401,
      headers: new Headers(),
      body: new Uint8Array(),
      finalUrl: "https://api.steampowered.com/ISteamUser/GetFriendList/v1/",
    });
    const adapter = createSteamFriendAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getFriends(
        parseSteamId64("76561198000000000"),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ visibility: "private", items: [] });
  });

  it("preserves a public empty friend list", async () => {
    const execute = vi.fn<SteamFriendHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({ friendslist: { friends: [] } }),
      ),
      finalUrl: "https://api.steampowered.com/ISteamUser/GetFriendList/v1/",
    });
    const adapter = createSteamFriendAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getFriends(
        parseSteamId64("76561198000000000"),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ visibility: "public", items: [] });
  });

  it("enriches one bounded batch by SteamID and marks the remainder", async () => {
    const profiles = [
      {
        steamId: parseSteamId64("76561198000000002"),
        displayName: "Second",
        profileUrl: "https://steamcommunity.com/profiles/76561198000000002/",
        visibility: "public",
        onlineState: "online",
      },
      {
        steamId: parseSteamId64("76561198000000001"),
        displayName: "First",
        profileUrl: "https://steamcommunity.com/profiles/76561198000000001/",
        visibility: "public",
        onlineState: "offline",
      },
    ] as const;
    const fetchPlayers = vi
      .fn<SteamPlayerBatchFetcher>()
      .mockResolvedValue(profiles);
    const friends = [
      { steamId: parseSteamId64("76561198000000001") },
      { steamId: parseSteamId64("76561198000000002") },
      { steamId: parseSteamId64("76561198000000003") },
    ];
    const signal = new AbortController().signal;

    await expect(
      enrichFriendProfiles(friends, 2, fetchPlayers, signal),
    ).resolves.toEqual([
      {
        relationship: friends[0],
        enrichment: {
          status: "available",
          profile: profiles[1],
        },
      },
      {
        relationship: friends[1],
        enrichment: {
          status: "available",
          profile: profiles[0],
        },
      },
      {
        relationship: friends[2],
        enrichment: { status: "fan_out_limited" },
      },
    ]);
    expect(fetchPlayers).toHaveBeenCalledWith(
      [
        parseSteamId64("76561198000000001"),
        parseSteamId64("76561198000000002"),
      ],
      signal,
    );
    expect(fetchPlayers).toHaveBeenCalledOnce();
  });

  it("keeps a relationship when its requested profile is unavailable", async () => {
    const fetchPlayers = vi.fn<SteamPlayerBatchFetcher>().mockResolvedValue([]);
    const relationship = {
      steamId: parseSteamId64("76561198000000001"),
    };

    await expect(
      enrichFriendProfiles(
        [relationship],
        1,
        fetchPlayers,
        new AbortController().signal,
      ),
    ).resolves.toEqual([
      { relationship, enrichment: { status: "unavailable" } },
    ]);
  });

  it("avoids an empty player-summary batch", async () => {
    const fetchPlayers = vi.fn<SteamPlayerBatchFetcher>();

    await expect(
      enrichFriendProfiles([], 20, fetchPlayers, new AbortController().signal),
    ).resolves.toEqual([]);
    expect(fetchPlayers).not.toHaveBeenCalled();
  });

  it("rejects invalid enrichment bounds before starting a batch", async () => {
    const fetchPlayers = vi.fn<SteamPlayerBatchFetcher>();
    const friends = [{ steamId: parseSteamId64("76561198000000001") }];

    await expect(
      enrichFriendProfiles(
        friends,
        101,
        fetchPlayers,
        new AbortController().signal,
      ),
    ).rejects.toThrow("Friend enrichment limit must be between 1 and 100");
    expect(fetchPlayers).not.toHaveBeenCalled();
  });

  it("does not start enrichment when cancellation is already requested", async () => {
    const fetchPlayers = vi.fn<SteamPlayerBatchFetcher>();
    const controller = new AbortController();
    controller.abort("sensitive reason");

    await expect(
      enrichFriendProfiles(
        [{ steamId: parseSteamId64("76561198000000001") }],
        1,
        fetchPlayers,
        controller.signal,
      ),
    ).rejects.toThrow("Steam friend enrichment cancelled");
    expect(fetchPlayers).not.toHaveBeenCalled();
  });

  it.each([
    ["SteamID", { steamid: "42", relationship: "friend", friend_since: 0 }],
    [
      "relationship",
      {
        steamid: "76561198000000001",
        relationship: "blocked",
        friend_since: 0,
      },
    ],
    [
      "timestamp",
      {
        steamid: "76561198000000001",
        relationship: "friend",
        friend_since: -1,
      },
    ],
  ])("rejects a malformed friend %s", async (_facet, friend) => {
    const execute = vi.fn<SteamFriendHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({ friendslist: { friends: [friend] } }),
      ),
      finalUrl: "https://api.steampowered.com/ISteamUser/GetFriendList/v1/",
    });
    const adapter = createSteamFriendAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getFriends(
        parseSteamId64("76561198000000000"),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      kind: "invalid_shape",
    });
  });
});
