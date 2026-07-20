import { describe, expect, it, vi } from "vitest";

import {
  createSteamPlayerAdapter,
  type SteamPlayerHttpExecutor,
} from "../../../src/steam/adapters/steam-player-adapter.js";
import { parseSteamId64 } from "../../../src/domain/steam-id.js";

describe("Steam player adapter", () => {
  it("normalizes a public player summary with presence and current game", async () => {
    const execute = vi.fn<SteamPlayerHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          response: {
            players: [
              {
                steamid: "76561198000000000",
                communityvisibilitystate: 3,
                personaname: "Synthetic Player",
                profileurl:
                  "https://steamcommunity.com/profiles/76561198000000000/",
                avatarfull: "https://avatars.steamstatic.com/synthetic.jpg",
                personastate: 1,
                gameid: "620",
                lastlogoff: 1_720_000_000,
              },
            ],
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/",
    });
    const adapter = createSteamPlayerAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });
    const signal = new AbortController().signal;

    await expect(
      adapter.getPlayers([parseSteamId64("76561198000000000")], signal),
    ).resolves.toEqual([
      {
        steamId: "76561198000000000",
        displayName: "Synthetic Player",
        profileUrl: "https://steamcommunity.com/profiles/76561198000000000/",
        avatarUrl: "https://avatars.steamstatic.com/synthetic.jpg",
        visibility: "public",
        onlineState: "online",
        currentAppId: 620,
        lastLogoffAt: new Date(1_720_000_000 * 1_000).toISOString(),
      },
    ]);
  });

  it("preserves private visibility without inventing optional profile facets", async () => {
    const execute = vi.fn<SteamPlayerHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          response: {
            players: [
              {
                steamid: "76561198000000000",
                communityvisibilitystate: 1,
                personaname: "Private Player",
                profileurl:
                  "https://steamcommunity.com/profiles/76561198000000000/",
                personastate: 0,
              },
            ],
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/",
    });
    const adapter = createSteamPlayerAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getPlayers(
        [parseSteamId64("76561198000000000")],
        new AbortController().signal,
      ),
    ).resolves.toEqual([
      {
        steamId: "76561198000000000",
        displayName: "Private Player",
        profileUrl: "https://steamcommunity.com/profiles/76561198000000000/",
        visibility: "private",
        onlineState: "offline",
      },
    ]);
  });

  it("normalizes Steam's busy persona state", async () => {
    const execute = vi.fn<SteamPlayerHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          response: {
            players: [
              {
                steamid: "76561198000000000",
                communityvisibilitystate: 3,
                personaname: "Busy Player",
                profileurl:
                  "https://steamcommunity.com/profiles/76561198000000000/",
                personastate: 2,
              },
            ],
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/",
    });
    const adapter = createSteamPlayerAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    const [player] = await adapter.getPlayers(
      [parseSteamId64("76561198000000000")],
      new AbortController().signal,
    );

    expect(player?.onlineState).toBe("busy");
  });

  it("coarsens Steam's away-like persona states to away", async () => {
    const execute = vi.fn<SteamPlayerHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          response: {
            players: [
              {
                steamid: "76561198000000000",
                communityvisibilitystate: 3,
                personaname: "Away Player",
                profileurl:
                  "https://steamcommunity.com/profiles/76561198000000000/",
                personastate: 4,
              },
            ],
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/",
    });
    const adapter = createSteamPlayerAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    const [player] = await adapter.getPlayers(
      [parseSteamId64("76561198000000000")],
      new AbortController().signal,
    );

    expect(player?.onlineState).toBe("away");
  });

  it("normalizes a documented player-ban summary", async () => {
    const execute = vi.fn<SteamPlayerHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          players: [
            {
              SteamId: "76561198000000000",
              CommunityBanned: false,
              VACBanned: true,
              NumberOfVACBans: 2,
              DaysSinceLastBan: 100,
              NumberOfGameBans: 1,
              EconomyBan: "none",
            },
          ],
        }),
      ),
      finalUrl: "https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/",
    });
    const adapter = createSteamPlayerAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getPlayerBans(
        [parseSteamId64("76561198000000000")],
        new AbortController().signal,
      ),
    ).resolves.toEqual([
      {
        steamId: "76561198000000000",
        communityBanned: false,
        vacBanCount: 2,
        gameBanCount: 1,
        economyBan: "none",
      },
    ]);
  });

  it("returns no players without issuing an empty upstream request", async () => {
    const execute = vi.fn<SteamPlayerHttpExecutor>();
    const adapter = createSteamPlayerAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getPlayers([], new AbortController().signal),
    ).resolves.toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns no ban summaries without issuing an empty upstream request", async () => {
    const execute = vi.fn<SteamPlayerHttpExecutor>();
    const adapter = createSteamPlayerAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getPlayerBans([], new AbortController().signal),
    ).resolves.toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a player-summary batch above Steam's documented limit", async () => {
    const execute = vi.fn<SteamPlayerHttpExecutor>();
    const adapter = createSteamPlayerAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });
    const steamIds = Array.from({ length: 101 }, () =>
      parseSteamId64("76561198000000000"),
    );

    await expect(
      adapter.getPlayers(steamIds, new AbortController().signal),
    ).rejects.toThrow("Steam player batch exceeds 100 IDs");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a player-ban batch above Steam's documented limit", async () => {
    const execute = vi.fn<SteamPlayerHttpExecutor>();
    const adapter = createSteamPlayerAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });
    const steamIds = Array.from({ length: 101 }, () =>
      parseSteamId64("76561198000000000"),
    );

    await expect(
      adapter.getPlayerBans(steamIds, new AbortController().signal),
    ).rejects.toThrow("Steam player batch exceeds 100 IDs");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range current game as malformed upstream data", async () => {
    const execute = vi.fn<SteamPlayerHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          response: {
            players: [
              {
                steamid: "76561198000000000",
                communityvisibilitystate: 3,
                personaname: "Synthetic Player",
                profileurl:
                  "https://steamcommunity.com/profiles/76561198000000000/",
                personastate: 1,
                gameid: "4294967296",
              },
            ],
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/",
    });
    const adapter = createSteamPlayerAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getPlayers(
        [parseSteamId64("76561198000000000")],
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      kind: "invalid_shape",
    });
  });

  it("rejects an unrepresentable last-logoff timestamp as malformed data", async () => {
    const execute = vi.fn<SteamPlayerHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          response: {
            players: [
              {
                steamid: "76561198000000000",
                communityvisibilitystate: 3,
                personaname: "Synthetic Player",
                profileurl:
                  "https://steamcommunity.com/profiles/76561198000000000/",
                personastate: 0,
                lastlogoff: 8_640_000_000_001,
              },
            ],
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/",
    });
    const adapter = createSteamPlayerAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getPlayers(
        [parseSteamId64("76561198000000000")],
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      kind: "invalid_shape",
    });
  });
});
