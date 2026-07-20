import { describe, expect, it, vi } from "vitest";

import { parseAppId } from "../../../src/domain/app-id.js";
import { parseSteamId64 } from "../../../src/domain/steam-id.js";
import {
  createSteamAchievementAdapter,
  type SteamAchievementHttpExecutor,
} from "../../../src/steam/adapters/steam-achievement-adapter.js";

describe("Steam achievement adapter", () => {
  it("normalizes locked and unlocked player progress by stable API name", async () => {
    const execute = vi.fn<SteamAchievementHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          playerstats: {
            steamID: "76561198000000000",
            gameName: "Portal 2",
            achievements: [
              {
                apiname: "ACH.WAKE_UP",
                achieved: 1,
                unlocktime: 1_720_000_000,
              },
              { apiname: "ACH.SECRET", achieved: 0, unlocktime: 0 },
            ],
            success: true,
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/",
    });
    const adapter = createSteamAchievementAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });
    const signal = new AbortController().signal;

    await expect(
      adapter.getPlayerAchievements(
        parseSteamId64("76561198000000000"),
        parseAppId(620),
        signal,
      ),
    ).resolves.toEqual({
      visibility: "public",
      items: [
        {
          apiName: "ACH.WAKE_UP",
          achieved: true,
          unlockedAt: new Date(1_720_000_000 * 1_000).toISOString(),
        },
        { apiName: "ACH.SECRET", achieved: false },
      ],
    });
    const [request, receivedSignal] = execute.mock.calls[0] ?? [];
    expect(request?.url).toBe(
      "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=synthetic-api-key&steamid=76561198000000000&appid=620&l=english",
    );
    expect(receivedSignal).toBe(signal);
  });

  it("preserves private achievement progress as a distinct collection state", async () => {
    const execute = vi.fn<SteamAchievementHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          playerstats: {
            steamID: "76561198000000000",
            success: false,
            error: "Profile is not public",
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/",
    });
    const adapter = createSteamAchievementAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getPlayerAchievements(
        parseSteamId64("76561198000000000"),
        parseAppId(620),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ visibility: "private", items: [] });
  });

  it("normalizes game achievement definitions by stable API name", async () => {
    const execute = vi.fn<SteamAchievementHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          game: {
            gameName: "Portal 2",
            gameVersion: "1",
            availableGameStats: {
              achievements: [
                {
                  name: "ACH.WAKE_UP",
                  defaultvalue: 0,
                  displayName: "Wake Up Call",
                  hidden: 0,
                  description: "Survive the manual override.",
                  icon: "https://cdn.akamai.steamstatic.com/icon.jpg",
                  icongray: "https://cdn.akamai.steamstatic.com/icon-gray.jpg",
                },
              ],
              stats: [],
            },
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/",
    });
    const adapter = createSteamAchievementAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });
    const signal = new AbortController().signal;

    await expect(
      adapter.getGameAchievementSchema(parseAppId(620), signal),
    ).resolves.toEqual([
      {
        apiName: "ACH.WAKE_UP",
        displayName: "Wake Up Call",
        description: "Survive the manual override.",
        hidden: false,
        iconUrl: "https://cdn.akamai.steamstatic.com/icon.jpg",
        lockedIconUrl: "https://cdn.akamai.steamstatic.com/icon-gray.jpg",
      },
    ]);
    const [request, receivedSignal] = execute.mock.calls[0] ?? [];
    expect(request?.url).toBe(
      "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=synthetic-api-key&appid=620&l=english",
    );
    expect(receivedSignal).toBe(signal);
  });

  it("normalizes optional global rarity percentages by stable API name", async () => {
    const execute = vi.fn<SteamAchievementHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          achievementpercentages: {
            achievements: [
              { name: "ACH.SECRET", percent: 4.25 },
              { name: "ACH.WAKE_UP", percent: 87.5 },
            ],
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/",
    });
    const adapter = createSteamAchievementAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });
    const signal = new AbortController().signal;

    await expect(
      adapter.getGlobalAchievementPercentages(parseAppId(620), signal),
    ).resolves.toEqual([
      { apiName: "ACH.SECRET", globalPercent: 4.25 },
      { apiName: "ACH.WAKE_UP", globalPercent: 87.5 },
    ]);
    const [request, receivedSignal] = execute.mock.calls[0] ?? [];
    expect(request?.url).toBe(
      "https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=620",
    );
    expect(receivedSignal).toBe(signal);
  });

  it("returns public empty progress when Steam reports no achievements", async () => {
    const execute = vi.fn<SteamAchievementHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          playerstats: {
            steamID: "76561198000000000",
            gameName: "Game Without Achievements",
            success: true,
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/",
    });
    const adapter = createSteamAchievementAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getPlayerAchievements(
        parseSteamId64("76561198000000000"),
        parseAppId(10),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ visibility: "public", items: [] });
  });

  it("rejects a locked achievement with a nonzero unlock time", async () => {
    const execute = vi.fn<SteamAchievementHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          playerstats: {
            steamID: "76561198000000000",
            gameName: "Portal 2",
            achievements: [
              { apiname: "ACH.SECRET", achieved: 0, unlocktime: 100 },
            ],
            success: true,
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/",
    });
    const adapter = createSteamAchievementAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getPlayerAchievements(
        parseSteamId64("76561198000000000"),
        parseAppId(620),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      kind: "invalid_shape",
    });
  });

  it("rejects progress returned for a different Steam account", async () => {
    const execute = vi.fn<SteamAchievementHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          playerstats: {
            steamID: "76561198000000001",
            gameName: "Portal 2",
            achievements: [],
            success: true,
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/",
    });
    const adapter = createSteamAchievementAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getPlayerAchievements(
        parseSteamId64("76561198000000000"),
        parseAppId(620),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      kind: "invalid_shape",
    });
  });

  it("rejects duplicate stable IDs in global rarity data", async () => {
    const execute = vi.fn<SteamAchievementHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          achievementpercentages: {
            achievements: [
              { name: "ACH.WAKE_UP", percent: 80 },
              { name: "ACH.WAKE_UP", percent: 81 },
            ],
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/",
    });
    const adapter = createSteamAchievementAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getGlobalAchievementPercentages(
        parseAppId(620),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      kind: "invalid_shape",
    });
  });

  it("rejects an unsupported non-private player-stat failure", async () => {
    const execute = vi.fn<SteamAchievementHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          playerstats: {
            steamID: "76561198000000000",
            success: false,
            error: "Unexpected upstream status",
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/",
    });
    const adapter = createSteamAchievementAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getPlayerAchievements(
        parseSteamId64("76561198000000000"),
        parseAppId(620),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      kind: "invalid_shape",
      retryable: false,
    });
  });

  it("normalizes a minimal hidden achievement definition", async () => {
    const execute = vi.fn<SteamAchievementHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          game: {
            gameName: "Portal 2",
            gameVersion: "1",
            availableGameStats: {
              achievements: [
                { name: "ACH.SECRET", defaultvalue: 0, hidden: 1 },
              ],
            },
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/",
    });
    const adapter = createSteamAchievementAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getGameAchievementSchema(
        parseAppId(620),
        new AbortController().signal,
      ),
    ).resolves.toEqual([{ apiName: "ACH.SECRET", hidden: true }]);
  });

  it("returns empty schema and rarity collections when facets are absent", async () => {
    const execute = vi
      .fn<SteamAchievementHttpExecutor>()
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        body: new TextEncoder().encode(
          JSON.stringify({
            game: { gameName: "No Achievements", gameVersion: "1" },
          }),
        ),
        finalUrl:
          "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/",
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        body: new TextEncoder().encode(
          JSON.stringify({ achievementpercentages: {} }),
        ),
        finalUrl:
          "https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/",
      });
    const adapter = createSteamAchievementAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.getGameAchievementSchema(
        parseAppId(10),
        new AbortController().signal,
      ),
    ).resolves.toEqual([]);
    await expect(
      adapter.getGlobalAchievementPercentages(
        parseAppId(10),
        new AbortController().signal,
      ),
    ).resolves.toEqual([]);
  });
});
