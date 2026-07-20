import { describe, expect, it, vi } from "vitest";

import { parseSteamId64 } from "../../../src/domain/steam-id.js";
import {
  createSteamLibraryAdapter,
  type SteamLibraryHttpExecutor,
} from "../../../src/steam/adapters/steam-library-adapter.js";

describe("Steam library adapter", () => {
  it("normalizes a public owned-games response", async () => {
    const execute = vi.fn<SteamLibraryHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          response: {
            game_count: 1,
            games: [
              {
                appid: 620,
                name: "Portal 2",
                playtime_forever: 1_234,
                playtime_2weeks: 45,
                rtime_last_played: 1_720_000_000,
              },
            ],
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/",
    });
    const adapter = createSteamLibraryAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });
    const signal = new AbortController().signal;

    await expect(
      adapter.getOwnedGames(parseSteamId64("76561198000000000"), signal),
    ).resolves.toEqual({
      visibility: "public",
      items: [
        {
          appId: 620,
          name: "Portal 2",
          playtimeMinutes: 1_234,
          recentPlaytimeMinutes: 45,
          lastPlayedAt: new Date(1_720_000_000 * 1_000).toISOString(),
        },
      ],
    });
    expect(execute).toHaveBeenCalledOnce();
    const [request, receivedSignal] = execute.mock.calls[0] ?? [];
    expect(request?.url).toBe(
      "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=synthetic-api-key&steamid=76561198000000000&include_appinfo=1&include_played_free_games=1&format=json",
    );
    expect(receivedSignal).toBe(signal);
  });

  it("distinguishes a private owned-games response from a public empty library", async () => {
    const execute = vi.fn<SteamLibraryHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(JSON.stringify({ response: {} })),
      finalUrl:
        "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/",
    });
    const adapter = createSteamLibraryAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getOwnedGames(
        parseSteamId64("76561198000000000"),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ visibility: "private", items: [] });
  });

  it("preserves an explicitly public empty owned-games response", async () => {
    const execute = vi.fn<SteamLibraryHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({ response: { game_count: 0 } }),
      ),
      finalUrl:
        "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/",
    });
    const adapter = createSteamLibraryAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getOwnedGames(
        parseSteamId64("76561198000000000"),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ visibility: "public", items: [] });
  });

  it("normalizes a bounded recently-played response", async () => {
    const execute = vi.fn<SteamLibraryHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          response: {
            total_count: 1,
            games: [
              {
                appid: 440,
                name: "Team Fortress 2",
                playtime_forever: 2_000,
                playtime_2weeks: 120,
                rtime_last_played: 1_721_000_000,
              },
            ],
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/",
    });
    const adapter = createSteamLibraryAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });
    const signal = new AbortController().signal;

    await expect(
      adapter.getRecentGames(parseSteamId64("76561198000000000"), signal),
    ).resolves.toEqual({
      visibility: "public",
      items: [
        {
          appId: 440,
          name: "Team Fortress 2",
          playtimeMinutes: 2_000,
          recentPlaytimeMinutes: 120,
          lastPlayedAt: new Date(1_721_000_000 * 1_000).toISOString(),
        },
      ],
    });
    const [request, receivedSignal] = execute.mock.calls[0] ?? [];
    expect(request?.url).toBe(
      "https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/?key=synthetic-api-key&steamid=76561198000000000&count=100&format=json",
    );
    expect(receivedSignal).toBe(signal);
  });

  it("distinguishes a private recently-played response", async () => {
    const execute = vi.fn<SteamLibraryHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(JSON.stringify({ response: {} })),
      finalUrl:
        "https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/",
    });
    const adapter = createSteamLibraryAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getRecentGames(
        parseSteamId64("76561198000000000"),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ visibility: "private", items: [] });
  });

  it("rejects an incomplete owned-games collection", async () => {
    const execute = vi.fn<SteamLibraryHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({ response: { game_count: 2, games: [] } }),
      ),
      finalUrl:
        "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/",
    });
    const adapter = createSteamLibraryAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getOwnedGames(
        parseSteamId64("76561198000000000"),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      kind: "invalid_shape",
      retryable: false,
    });
  });

  it("rejects a recently-played response above its request bound", async () => {
    const games = Array.from({ length: 101 }, (_, index) => ({
      appid: index + 1,
      playtime_forever: 1,
    }));
    const execute = vi.fn<SteamLibraryHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({ response: { total_count: 101, games } }),
      ),
      finalUrl:
        "https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/",
    });
    const adapter = createSteamLibraryAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getRecentGames(
        parseSteamId64("76561198000000000"),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      kind: "invalid_shape",
    });
  });

  it("rejects playtime outside Steam's unsigned 32-bit contract", async () => {
    const execute = vi.fn<SteamLibraryHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          response: {
            game_count: 1,
            games: [{ appid: 620, playtime_forever: 4_294_967_296 }],
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/",
    });
    const adapter = createSteamLibraryAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getOwnedGames(
        parseSteamId64("76561198000000000"),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      kind: "invalid_shape",
    });
  });
});
