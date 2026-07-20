import { describe, expect, it, vi } from "vitest";

import { parseCurrencyCode } from "../../../src/domain/currency.js";
import { parseSteamId64 } from "../../../src/domain/steam-id.js";
import {
  createSteamWishlistAdapter,
  type SteamWishlistHttpExecutor,
} from "../../../src/steam/adapters/steam-wishlist-adapter.js";

describe("Steam wishlist adapter", () => {
  it("normalizes only the requested enriched page and reports the total", async () => {
    const execute = vi.fn<SteamWishlistHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          response: {
            items: [
              { appid: 10, priority: 1, date_added: 1_700_000_000 },
              {
                appid: 620,
                priority: 2,
                date_added: 1_710_000_000,
                store_item: {
                  appid: 620,
                  success: 1,
                  visible: true,
                  name: "Portal 2",
                  best_purchase_option: {
                    price_in_cents: "499",
                    original_price_in_cents: "999",
                    discount_pct: 50,
                  },
                },
              },
              { appid: 440, priority: 3, date_added: 1_720_000_000 },
            ],
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/IWishlistService/GetWishlistSortedFiltered/v1/",
    });
    const adapter = createSteamWishlistAdapter({
      execute,
      enabled: true,
      countryCode: "US",
      currency: parseCurrencyCode("USD"),
      language: "english",
      maxPageSize: 100,
    });
    const signal = new AbortController().signal;

    await expect(
      adapter.getWishlist(
        parseSteamId64("76561198000000000"),
        { startIndex: 1, pageSize: 1 },
        signal,
      ),
    ).resolves.toEqual({
      visibility: "public",
      totalCount: 3,
      items: [
        {
          appId: 620,
          name: "Portal 2",
          available: true,
          price: { minorUnits: 499, currency: "USD" },
          discountPercent: 50,
        },
      ],
    });
    expect(execute).toHaveBeenCalledOnce();
    const [request, receivedSignal] = execute.mock.calls[0] ?? [];
    const url = new URL(request?.url ?? "");
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://api.steampowered.com/IWishlistService/GetWishlistSortedFiltered/v1/",
    );
    expect(JSON.parse(url.searchParams.get("input_json") ?? "null")).toEqual({
      steamid: "76561198000000000",
      context: {
        language: "english",
        country_code: "US",
        steam_realm: 1,
      },
      data_request: {
        include_basic_info: true,
        include_all_purchase_options: true,
      },
      filters: {},
      start_index: 1,
      page_size: 1,
      share_token: "",
    });
    expect(receivedSignal).toBe(signal);
  });

  it("maps contract drift to a sanitized best-effort failure", async () => {
    const execute = vi.fn<SteamWishlistHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({ response: { items: "sensitive-upstream-marker" } }),
      ),
      finalUrl:
        "https://api.steampowered.com/IWishlistService/GetWishlistSortedFiltered/v1/",
    });
    const adapter = createSteamWishlistAdapter({
      execute,
      enabled: true,
      countryCode: "US",
      currency: parseCurrencyCode("USD"),
      language: "english",
      maxPageSize: 100,
    });

    const execution = adapter.getWishlist(
      parseSteamId64("76561198000000000"),
      { startIndex: 0, pageSize: 20 },
      new AbortController().signal,
    );

    await expect(execution).rejects.toMatchObject({
      code: "BEST_EFFORT_SOURCE_CHANGED",
      retryable: false,
    });
    await expect(execution).rejects.not.toThrow("sensitive-upstream-marker");
  });

  it("preserves an empty wrapper as private or otherwise unavailable", async () => {
    const execute = vi.fn<SteamWishlistHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(JSON.stringify({ response: {} })),
      finalUrl:
        "https://api.steampowered.com/IWishlistService/GetWishlistSortedFiltered/v1/",
    });
    const adapter = createSteamWishlistAdapter({
      execute,
      enabled: true,
      countryCode: "US",
      currency: parseCurrencyCode("USD"),
      language: "english",
      maxPageSize: 100,
    });

    await expect(
      adapter.getWishlist(
        parseSteamId64("76561198000000000"),
        { startIndex: 0, pageSize: 20 },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ visibility: "private", items: [] });
  });

  it("distinguishes an explicitly public empty wishlist", async () => {
    const execute = vi.fn<SteamWishlistHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({ response: { items: [] } }),
      ),
      finalUrl:
        "https://api.steampowered.com/IWishlistService/GetWishlistSortedFiltered/v1/",
    });
    const adapter = createSteamWishlistAdapter({
      execute,
      enabled: true,
      countryCode: "US",
      currency: parseCurrencyCode("USD"),
      language: "english",
      maxPageSize: 100,
    });

    await expect(
      adapter.getWishlist(
        parseSteamId64("76561198000000000"),
        { startIndex: 0, pageSize: 20 },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      visibility: "public",
      totalCount: 0,
      items: [],
    });
  });

  it.each([
    [{ startIndex: -1, pageSize: 20 }, "start index"],
    [{ startIndex: 0.5, pageSize: 20 }, "start index"],
    [{ startIndex: 0, pageSize: 0 }, "page size"],
    [{ startIndex: 0, pageSize: 101 }, "page size"],
  ])("rejects an invalid wishlist %s", async (page, expectedMessage) => {
    const execute = vi.fn<SteamWishlistHttpExecutor>();
    const adapter = createSteamWishlistAdapter({
      execute,
      enabled: true,
      countryCode: "US",
      currency: parseCurrencyCode("USD"),
      language: "english",
      maxPageSize: 100,
    });

    await expect(
      adapter.getWishlist(
        parseSteamId64("76561198000000000"),
        page,
        new AbortController().signal,
      ),
    ).rejects.toThrow(expectedMessage);
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps an unavailable selected app without inventing store facts", async () => {
    const execute = vi.fn<SteamWishlistHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          response: {
            items: [
              { appid: 999_999_999, priority: 1, date_added: 1_700_000_000 },
            ],
          },
        }),
      ),
      finalUrl:
        "https://api.steampowered.com/IWishlistService/GetWishlistSortedFiltered/v1/",
    });
    const adapter = createSteamWishlistAdapter({
      execute,
      enabled: true,
      countryCode: "US",
      currency: parseCurrencyCode("USD"),
      language: "english",
      maxPageSize: 100,
    });

    await expect(
      adapter.getWishlist(
        parseSteamId64("76561198000000000"),
        { startIndex: 0, pageSize: 1 },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      visibility: "public",
      totalCount: 1,
      items: [{ appId: 999_999_999, available: false }],
    });
  });

  it("can be disabled without issuing upstream work", async () => {
    const execute = vi.fn<SteamWishlistHttpExecutor>();
    const adapter = createSteamWishlistAdapter({
      execute,
      enabled: false,
      countryCode: "US",
      currency: parseCurrencyCode("USD"),
      language: "english",
      maxPageSize: 100,
    });

    await expect(
      adapter.getWishlist(
        parseSteamId64("76561198000000000"),
        { startIndex: 0, pageSize: 20 },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects invalid storefront policy at construction", () => {
    const execute = vi.fn<SteamWishlistHttpExecutor>();

    expect(() =>
      createSteamWishlistAdapter({
        execute,
        enabled: true,
        countryCode: "USA",
        currency: parseCurrencyCode("USD"),
        language: "english",
        maxPageSize: 0,
      }),
    ).toThrow("Invalid Steam wishlist storefront policy");
    expect(execute).not.toHaveBeenCalled();
  });
});
