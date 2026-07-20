import { describe, expect, it, vi } from "vitest";

import { parseAppId } from "../../../src/domain/app-id.js";
import {
  createSteamTagAdapter,
  type SteamTagHttpExecutor,
} from "../../../src/steam/adapters/steam-tag-adapter.js";

describe("Steam tag adapter", () => {
  it("joins bounded app tags to Steam's localized vocabulary", async () => {
    const execute = vi
      .fn<SteamTagHttpExecutor>()
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        body: new TextEncoder().encode(
          JSON.stringify({
            response: {
              store_items: [
                {
                  appid: 620,
                  success: 1,
                  name: "Portal 2",
                  tags: [
                    { tagid: 1663, weight: 120 },
                    { tagid: 4106, weight: 80 },
                  ],
                },
              ],
            },
          }),
        ),
        finalUrl:
          "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/",
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        body: new TextEncoder().encode(
          JSON.stringify([
            { tagid: 1663, name: "First-Person" },
            { tagid: 4106, name: "Action-Adventure" },
          ]),
        ),
        finalUrl: "https://store.steampowered.com/tagdata/populartags/english",
      });
    const adapter = createSteamTagAdapter({
      execute,
      enabled: true,
      countryCode: "US",
      language: "english",
    });
    const signal = new AbortController().signal;

    await expect(adapter.getGameTags(parseAppId(620), signal)).resolves.toEqual(
      [
        { tagId: 1663, weight: 120, name: "First-Person" },
        { tagId: 4106, weight: 80, name: "Action-Adventure" },
      ],
    );
    const [appRequest, appSignal] = execute.mock.calls[0] ?? [];
    const appUrl = new URL(appRequest?.url ?? "");
    expect(`${appUrl.origin}${appUrl.pathname}`).toBe(
      "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/",
    );
    expect(JSON.parse(appUrl.searchParams.get("input_json") ?? "null")).toEqual(
      {
        ids: [{ appid: 620 }],
        context: { language: "english", country_code: "US" },
        data_request: { include_tag_count: 20 },
      },
    );
    expect(appSignal).toBe(signal);
    expect(execute.mock.calls[1]?.[0].url).toBe(
      "https://store.steampowered.com/tagdata/populartags/english",
    );
    expect(execute.mock.calls[1]?.[1]).toBe(signal);
  });

  it("rejects an invalid negative StoreBrowse result code", async () => {
    const execute = vi.fn<SteamTagHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          response: {
            store_items: [{ appid: 620, success: -1 }],
          },
        }),
      ),
      finalUrl: "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/",
    });
    const adapter = createSteamTagAdapter({
      execute,
      enabled: true,
      countryCode: "US",
      language: "english",
    });

    await expect(
      adapter.getGameTags(parseAppId(620), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "BEST_EFFORT_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("returns available empty tags without fetching the vocabulary", async () => {
    const execute = vi.fn<SteamTagHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          response: { store_items: [{ appid: 620, success: 1 }] },
        }),
      ),
      finalUrl: "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/",
    });
    const adapter = createSteamTagAdapter({
      execute,
      enabled: true,
      countryCode: "US",
      language: "english",
    });

    await expect(
      adapter.getGameTags(parseAppId(620), new AbortController().signal),
    ).resolves.toEqual([]);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("preserves a weighted tag whose localized name is unavailable", async () => {
    const execute = vi
      .fn<SteamTagHttpExecutor>()
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        body: new TextEncoder().encode(
          JSON.stringify({
            response: {
              store_items: [
                {
                  appid: 620,
                  success: 1,
                  tags: [{ tagid: 999, weight: 12 }],
                },
              ],
            },
          }),
        ),
        finalUrl:
          "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/",
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        body: new TextEncoder().encode(JSON.stringify([])),
        finalUrl: "https://store.steampowered.com/tagdata/populartags/english",
      });
    const adapter = createSteamTagAdapter({
      execute,
      enabled: true,
      countryCode: "US",
      language: "english",
    });

    await expect(
      adapter.getGameTags(parseAppId(620), new AbortController().signal),
    ).resolves.toEqual([{ tagId: 999, weight: 12 }]);
  });

  it("treats a non-success app result as unavailable without vocabulary work", async () => {
    const execute = vi.fn<SteamTagHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          response: { store_items: [{ appid: 620, success: 8 }] },
        }),
      ),
      finalUrl: "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/",
    });
    const adapter = createSteamTagAdapter({
      execute,
      enabled: true,
      countryCode: "US",
      language: "english",
    });

    await expect(
      adapter.getGameTags(parseAppId(620), new AbortController().signal),
    ).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledOnce();
  });

  it("disables the tag composite before issuing upstream work", async () => {
    const execute = vi.fn<SteamTagHttpExecutor>();
    const adapter = createSteamTagAdapter({
      execute,
      enabled: false,
      countryCode: "US",
      language: "english",
    });

    await expect(
      adapter.getGameTags(parseAppId(620), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ["empty item collection", []],
    [
      "multiple item collection",
      [
        { appid: 620, success: 1 },
        { appid: 620, success: 1 },
      ],
    ],
    ["mismatched app", [{ appid: 440, success: 1 }]],
    [
      "duplicate tags",
      [
        {
          appid: 620,
          success: 1,
          tags: [
            { tagid: 1, weight: 10 },
            { tagid: 1, weight: 5 },
          ],
        },
      ],
    ],
    [
      "more than twenty tags",
      [
        {
          appid: 620,
          success: 1,
          tags: Array.from({ length: 21 }, (_, index) => ({
            tagid: index + 1,
            weight: index,
          })),
        },
      ],
    ],
  ])("classifies %s as StoreBrowse drift", async (_case, storeItems) => {
    const execute = vi.fn<SteamTagHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({ response: { store_items: storeItems } }),
      ),
      finalUrl: "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/",
    });
    const adapter = createSteamTagAdapter({
      execute,
      enabled: true,
      countryCode: "US",
      language: "english",
    });

    await expect(
      adapter.getGameTags(parseAppId(620), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "BEST_EFFORT_SOURCE_CHANGED",
      retryable: false,
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("classifies duplicate vocabulary IDs as best-effort drift", async () => {
    const execute = vi
      .fn<SteamTagHttpExecutor>()
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        body: new TextEncoder().encode(
          JSON.stringify({
            response: {
              store_items: [
                {
                  appid: 620,
                  success: 1,
                  tags: [{ tagid: 1, weight: 10 }],
                },
              ],
            },
          }),
        ),
        finalUrl:
          "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/",
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        body: new TextEncoder().encode(
          JSON.stringify([
            { tagid: 1, name: "One" },
            { tagid: 1, name: "Duplicate" },
          ]),
        ),
        finalUrl: "https://store.steampowered.com/tagdata/populartags/english",
      });
    const adapter = createSteamTagAdapter({
      execute,
      enabled: true,
      countryCode: "US",
      language: "english",
    });

    await expect(
      adapter.getGameTags(parseAppId(620), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "BEST_EFFORT_SOURCE_CHANGED",
      retryable: false,
    });
  });
});
