import { describe, expect, it, vi } from "vitest";

import { parseAppId } from "../../../src/domain/app-id.js";
import {
  createSteamGameAdapter,
  type SteamGameHttpExecutor,
} from "../../../src/steam/adapters/steam-game-adapter.js";

describe("Steam game adapter", () => {
  it("normalizes the current player count", async () => {
    const execute = vi.fn<SteamGameHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({ response: { player_count: 1_536, result: 1 } }),
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/",
    });
    const adapter = createSteamGameAdapter({ execute, maxNewsItems: 20 });
    const signal = new AbortController().signal;

    await expect(
      adapter.getCurrentPlayers(parseAppId(620), signal),
    ).resolves.toBe(1_536);
    const [request, receivedSignal] = execute.mock.calls[0] ?? [];
    expect(request?.url).toBe(
      "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=620",
    );
    expect(receivedSignal).toBe(signal);
  });

  it("normalizes bounded game news without retaining article content", async () => {
    const execute = vi.fn<SteamGameHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          appnews: {
            appid: 620,
            newsitems: [
              {
                gid: "1234567890123456789",
                title: "Synthetic Update",
                url: "https://store.steampowered.com/news/app/620/view/123",
                is_external_url: false,
                author: "Valve",
                contents: "<p>Content intentionally discarded.</p>",
                feedlabel: "Community Announcements",
                date: 1_720_000_000,
                feedname: "steam_community_announcements",
                feed_type: 1,
                appid: 620,
              },
            ],
            count: 100,
          },
        }),
      ),
      finalUrl: "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/",
    });
    const adapter = createSteamGameAdapter({ execute, maxNewsItems: 20 });
    const signal = new AbortController().signal;

    await expect(adapter.getGameNews(parseAppId(620), signal)).resolves.toEqual(
      [
        {
          id: "1234567890123456789",
          title: "Synthetic Update",
          url: "https://store.steampowered.com/news/app/620/view/123",
          publishedAt: new Date(1_720_000_000 * 1_000).toISOString(),
        },
      ],
    );
    const [request, receivedSignal] = execute.mock.calls[0] ?? [];
    expect(request?.url).toBe(
      "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=620&count=20&maxlength=1",
    );
    expect(receivedSignal).toBe(signal);
  });

  it("accepts zero current players", async () => {
    const execute = vi.fn<SteamGameHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({ response: { player_count: 0, result: 1 } }),
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/",
    });
    const adapter = createSteamGameAdapter({ execute, maxNewsItems: 20 });

    await expect(
      adapter.getCurrentPlayers(parseAppId(620), new AbortController().signal),
    ).resolves.toBe(0);
  });

  it("preserves a valid empty news collection", async () => {
    const execute = vi.fn<SteamGameHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          appnews: { appid: 620, newsitems: [], count: 0 },
        }),
      ),
      finalUrl: "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/",
    });
    const adapter = createSteamGameAdapter({ execute, maxNewsItems: 20 });

    await expect(
      adapter.getGameNews(parseAppId(620), new AbortController().signal),
    ).resolves.toEqual([]);
  });

  it("rejects a news collection larger than its advertised total", async () => {
    const execute = vi.fn<SteamGameHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          appnews: {
            appid: 620,
            newsitems: [
              {
                gid: "1",
                title: "Synthetic Update",
                url: "https://store.steampowered.com/news/app/620/view/1",
                date: 1_720_000_000,
                appid: 620,
              },
            ],
            count: 0,
          },
        }),
      ),
      finalUrl: "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/",
    });
    const adapter = createSteamGameAdapter({ execute, maxNewsItems: 20 });

    await expect(
      adapter.getGameNews(parseAppId(620), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      kind: "invalid_shape",
    });
  });

  it.each([
    ["failure result", { player_count: 1, result: 42 }],
    ["negative count", { player_count: -1, result: 1 }],
    ["fractional count", { player_count: 1.5, result: 1 }],
    ["unsafe count", { player_count: Number.MAX_SAFE_INTEGER + 1, result: 1 }],
  ])("rejects a malformed current-player %s", async (_case, response) => {
    const execute = vi.fn<SteamGameHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(JSON.stringify({ response })),
      finalUrl:
        "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/",
    });
    const adapter = createSteamGameAdapter({ execute, maxNewsItems: 20 });

    await expect(
      adapter.getCurrentPlayers(parseAppId(620), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      kind: "invalid_shape",
    });
  });

  it("rejects news returned for a different app", async () => {
    const execute = vi.fn<SteamGameHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          appnews: { appid: 440, newsitems: [], count: 0 },
        }),
      ),
      finalUrl: "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/",
    });
    const adapter = createSteamGameAdapter({ execute, maxNewsItems: 20 });

    await expect(
      adapter.getGameNews(parseAppId(620), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      kind: "invalid_shape",
    });
  });

  it("rejects a news response above the configured bound", async () => {
    const newsitems = [1, 2].map((id) => ({
      gid: String(id),
      title: `Update ${String(id)}`,
      url: `https://store.steampowered.com/news/app/620/view/${String(id)}`,
      date: 1_720_000_000,
      appid: 620,
    }));
    const execute = vi.fn<SteamGameHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          appnews: { appid: 620, newsitems, count: newsitems.length },
        }),
      ),
      finalUrl: "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/",
    });
    const adapter = createSteamGameAdapter({ execute, maxNewsItems: 1 });

    await expect(
      adapter.getGameNews(parseAppId(620), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      kind: "invalid_shape",
    });
  });

  it("rejects an invalid news limit at construction", () => {
    const execute = vi.fn<SteamGameHttpExecutor>();

    expect(() => createSteamGameAdapter({ execute, maxNewsItems: 0 })).toThrow(
      "News item limit must be between 1 and 200",
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
