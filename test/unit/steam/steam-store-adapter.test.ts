import { describe, expect, it, vi } from "vitest";

import { parseAppId } from "../../../src/domain/app-id.js";
import {
  createSteamStoreAdapter,
  type SteamStoreHttpExecutor,
} from "../../../src/steam/adapters/steam-store-adapter.js";

describe("Steam store adapter", () => {
  it("preserves ranked ambiguous search candidates with localized evidence", async () => {
    const execute = vi.fn<SteamStoreHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          total: 2,
          items: [
            {
              type: "app",
              name: "Portal",
              id: 400,
              tiny_image: "https://shared.akamai.steamstatic.com/portal.jpg",
              price: {
                currency: "USD",
                initial: 999,
                final: 499,
                discount_percent: 50,
              },
              platforms: { windows: true, mac: true, linux: true },
              metascore: "90",
              controller_support: "full",
            },
            {
              type: "app",
              name: "Portal 2",
              id: 620,
              platforms: { windows: true, mac: true, linux: true },
              metascore: "95",
            },
          ],
        }),
      ),
      finalUrl: "https://store.steampowered.com/api/storesearch/",
    });
    const adapter = createSteamStoreAdapter({
      execute,
      searchEnabled: true,
      detailsEnabled: true,
      countryCode: "US",
      language: "english",
    });
    const signal = new AbortController().signal;

    await expect(adapter.searchGames("portal", signal)).resolves.toEqual([
      {
        appId: 400,
        name: "Portal",
        imageUrl: "https://shared.akamai.steamstatic.com/portal.jpg",
        price: { minorUnits: 499, currency: "USD" },
        originalPrice: { minorUnits: 999, currency: "USD" },
        discountPercent: 50,
        platforms: { windows: true, mac: true, linux: true },
        metascore: 90,
        controllerSupport: "full",
      },
      {
        appId: 620,
        name: "Portal 2",
        platforms: { windows: true, mac: true, linux: true },
        metascore: 95,
      },
    ]);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://store.steampowered.com/api/storesearch/?term=portal&l=english&cc=US",
      }),
      signal,
    );
  });

  it("treats an empty Steam metascore as unavailable", async () => {
    const execute = vi.fn<SteamStoreHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          total: 1,
          items: [
            {
              type: "app",
              name: "Unscored Game",
              id: 10,
              metascore: "",
            },
          ],
        }),
      ),
      finalUrl: "https://store.steampowered.com/api/storesearch/",
    });
    const adapter = createSteamStoreAdapter({
      execute,
      searchEnabled: true,
      detailsEnabled: true,
      countryCode: "US",
      language: "english",
    });

    await expect(
      adapter.searchGames("unscored", new AbortController().signal),
    ).resolves.toEqual([{ appId: 10, name: "Unscored Game" }]);
  });

  it("normalizes one regional store-detail response", async () => {
    const execute = vi.fn<SteamStoreHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          "620": {
            success: true,
            data: {
              type: "game",
              name: "Portal 2",
              steam_appid: 620,
              short_description: "The perpetual testing initiative continues.",
              developers: ["Valve"],
              publishers: ["Valve"],
              genres: [{ id: "3", description: "Action" }],
              categories: [
                { id: 2, description: "Single-player" },
                { id: 22, description: "Steam Achievements" },
              ],
              price_overview: {
                currency: "USD",
                initial: 999,
                final: 499,
                discount_percent: 50,
              },
              release_date: { coming_soon: false, date: "Apr 18, 2011" },
            },
          },
        }),
      ),
      finalUrl: "https://store.steampowered.com/api/appdetails",
    });
    const adapter = createSteamStoreAdapter({
      execute,
      searchEnabled: true,
      detailsEnabled: true,
      countryCode: "US",
      language: "english",
    });
    const signal = new AbortController().signal;

    await expect(
      adapter.getStoreGame(parseAppId(620), signal),
    ).resolves.toEqual({
      appId: 620,
      name: "Portal 2",
      shortDescription: "The perpetual testing initiative continues.",
      developers: ["Valve"],
      publishers: ["Valve"],
      genres: ["Action"],
      categories: ["Single-player", "Steam Achievements"],
      price: { minorUnits: 499, currency: "USD" },
      originalPrice: { minorUnits: 999, currency: "USD" },
      discountPercent: 50,
      releaseDate: "Apr 18, 2011",
    });
    const [request, receivedSignal] = execute.mock.calls[0] ?? [];
    const url = new URL(request?.url ?? "");
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://store.steampowered.com/api/appdetails",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      appids: "620",
      cc: "US",
      l: "english",
      filters:
        "basic,developers,publishers,genres,categories,price_overview,release_date",
    });
    expect(receivedSignal).toBe(signal);
  });

  it("returns undefined for an unavailable regional app", async () => {
    const execute = vi.fn<SteamStoreHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({ "999999999": { success: false } }),
      ),
      finalUrl: "https://store.steampowered.com/api/appdetails",
    });
    const adapter = createSteamStoreAdapter({
      execute,
      searchEnabled: true,
      detailsEnabled: true,
      countryCode: "US",
      language: "english",
    });

    await expect(
      adapter.getStoreGame(
        parseAppId(999_999_999),
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects store details returned under a different app key", async () => {
    const execute = vi.fn<SteamStoreHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({ "440": { success: false } }),
      ),
      finalUrl: "https://store.steampowered.com/api/appdetails",
    });
    const adapter = createSteamStoreAdapter({
      execute,
      searchEnabled: true,
      detailsEnabled: true,
      countryCode: "US",
      language: "english",
    });

    await expect(
      adapter.getStoreGame(parseAppId(620), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "BEST_EFFORT_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("rejects a search response above the observed ten-candidate bound", async () => {
    const items = Array.from({ length: 11 }, (_, index) => ({
      type: "app",
      name: `Synthetic ${String(index)}`,
      id: index + 1,
    }));
    const execute = vi.fn<SteamStoreHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({ total: items.length, items }),
      ),
      finalUrl: "https://store.steampowered.com/api/storesearch/",
    });
    const adapter = createSteamStoreAdapter({
      execute,
      searchEnabled: true,
      detailsEnabled: true,
      countryCode: "US",
      language: "english",
    });

    await expect(
      adapter.searchGames("synthetic", new AbortController().signal),
    ).rejects.toMatchObject({
      code: "BEST_EFFORT_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("rejects blank search without issuing upstream work", async () => {
    const execute = vi.fn<SteamStoreHttpExecutor>();
    const adapter = createSteamStoreAdapter({
      execute,
      searchEnabled: true,
      detailsEnabled: true,
      countryCode: "US",
      language: "english",
    });

    await expect(
      adapter.searchGames("   ", new AbortController().signal),
    ).rejects.toThrow("Store search query must contain 1 to 100 characters");
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps search and store-detail disable switches independent", async () => {
    const execute = vi.fn<SteamStoreHttpExecutor>();
    const searchDisabled = createSteamStoreAdapter({
      execute,
      searchEnabled: false,
      detailsEnabled: true,
      countryCode: "US",
      language: "english",
    });
    const detailsDisabled = createSteamStoreAdapter({
      execute,
      searchEnabled: true,
      detailsEnabled: false,
      countryCode: "US",
      language: "english",
    });

    await expect(
      searchDisabled.searchGames("portal", new AbortController().signal),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    await expect(
      detailsDisabled.getStoreGame(
        parseAppId(620),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects invalid storefront policy during construction", () => {
    const execute = vi.fn<SteamStoreHttpExecutor>();

    expect(() =>
      createSteamStoreAdapter({
        execute,
        searchEnabled: true,
        detailsEnabled: true,
        countryCode: "USA",
        language: "english",
      }),
    ).toThrow("Invalid Steam storefront policy");
    expect(execute).not.toHaveBeenCalled();
  });
});
