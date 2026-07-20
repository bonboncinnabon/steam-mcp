import { describe, expect, it, vi } from "vitest";

import { parseAppId } from "../../../src/domain/app-id.js";
import {
  createSteamDeckAdapter,
  type SteamDeckHttpExecutor,
} from "../../../src/steam/adapters/steam-deck-adapter.js";

describe("Steam Deck adapter", () => {
  it("normalizes playable compatibility and ignores untranslated details", async () => {
    const execute = vi.fn<SteamDeckHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          success: 1,
          results: {
            appid: 570,
            resolved_category: 2,
            resolved_items: [
              { display_type: 3, loc_token: "#SteamDeckVerified_TestResult" },
            ],
            steam_os: 1,
          },
        }),
      ),
      finalUrl:
        "https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID=570",
    });
    const adapter = createSteamDeckAdapter({ execute, enabled: true });
    const signal = new AbortController().signal;

    await expect(
      adapter.getDeckCompatibility(parseAppId(570), signal),
    ).resolves.toEqual({ category: "playable" });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID=570",
      }),
      signal,
    );
  });

  it("treats empty compatibility results as unavailable", async () => {
    const execute = vi.fn<SteamDeckHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({ success: 1, results: [] }),
      ),
      finalUrl:
        "https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID=999999999",
    });
    const adapter = createSteamDeckAdapter({ execute, enabled: true });

    await expect(
      adapter.getDeckCompatibility(
        parseAppId(999_999_999),
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    [0, "unknown"],
    [1, "unsupported"],
    [3, "verified"],
  ] as const)("maps category %i to %s", async (resolvedCategory, category) => {
    const execute = vi.fn<SteamDeckHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          success: 1,
          results: { appid: 620, resolved_category: resolvedCategory },
        }),
      ),
      finalUrl:
        "https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID=620",
    });
    const adapter = createSteamDeckAdapter({ execute, enabled: true });

    await expect(
      adapter.getDeckCompatibility(
        parseAppId(620),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ category });
  });

  it("classifies a mismatched app response as best-effort drift", async () => {
    const execute = vi.fn<SteamDeckHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          success: 1,
          results: { appid: 440, resolved_category: 3 },
        }),
      ),
      finalUrl:
        "https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID=620",
    });
    const adapter = createSteamDeckAdapter({ execute, enabled: true });

    await expect(
      adapter.getDeckCompatibility(
        parseAppId(620),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "BEST_EFFORT_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("disables Deck compatibility without issuing upstream work", async () => {
    const execute = vi.fn<SteamDeckHttpExecutor>();
    const adapter = createSteamDeckAdapter({ execute, enabled: false });

    await expect(
      adapter.getDeckCompatibility(
        parseAppId(620),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
