import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseAppId } from "../../src/domain/app-id.js";
import { parseCurrencyCode } from "../../src/domain/currency.js";
import { createSteamDeckAdapter } from "../../src/steam/adapters/steam-deck-adapter.js";
import { createSteamPlayerAdapter } from "../../src/steam/adapters/steam-player-adapter.js";
import { createSteamReviewAdapter } from "../../src/steam/adapters/steam-review-adapter.js";
import { createSteamStoreAdapter } from "../../src/steam/adapters/steam-store-adapter.js";
import { createSteamTagAdapter } from "../../src/steam/adapters/steam-tag-adapter.js";
import { createSteamWishlistAdapter } from "../../src/steam/adapters/steam-wishlist-adapter.js";
import { executeSteamRequest } from "../../src/steam/http/steam-http-client.js";
import type { SteamHttpRequest } from "../../src/steam/http/steam-request.js";
import {
  LiveProbeMetrics,
  readLiveProbeEnvironment,
  type LiveProbeEnvironment,
  type LiveProbeName,
} from "../support/live-probe.js";

const liveEnabled = process.env["STEAM_LIVE_TESTS"] === "1";
const metrics = new LiveProbeMetrics();
const publicProbeAppId = parseAppId(620);

const execute = (request: SteamHttpRequest, signal: AbortSignal) =>
  executeSteamRequest(request, {
    deadlineMs: 5_000,
    maxResponseBytes: 512_000,
    maxRetryAttempts: 0,
    signal,
  });

async function probe<T>(
  name: LiveProbeName,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    const result = await operation();
    metrics.record(name, "passed");
    return result;
  } catch (error) {
    metrics.record(
      name,
      hasErrorCode(error, "BEST_EFFORT_SOURCE_CHANGED")
        ? "drifted"
        : "unavailable",
    );
    throw error;
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

describe.skipIf(!liveEnabled)("live Steam contracts", () => {
  let environment: LiveProbeEnvironment;

  beforeAll(() => {
    environment = readLiveProbeEnvironment(process.env);
  });

  afterAll(() => {
    process.stdout.write(
      `[live-probe-metrics] ${JSON.stringify(metrics.snapshot())}\n`,
    );
  });

  it("validates one supported player summary with the dedicated credential", async () => {
    const adapter = createSteamPlayerAdapter({
      apiKey: environment.apiKey,
      execute,
    });

    const players = await probe("supported_player", () =>
      adapter.getPlayers([environment.steamId], new AbortController().signal),
    );

    expect(players).toHaveLength(1);
    expect(players[0]?.steamId).toBe(environment.steamId);
  });

  it("validates the dedicated account's best-effort wishlist wrapper", async () => {
    const adapter = createSteamWishlistAdapter({
      execute,
      enabled: true,
      countryCode: "US",
      currency: parseCurrencyCode("USD"),
      language: "english",
      maxPageSize: 20,
    });

    const wishlist = await probe("wishlist", () =>
      adapter.getWishlist(
        environment.steamId,
        { startIndex: 0, pageSize: 1 },
        new AbortController().signal,
      ),
    );

    expect(["public", "private"]).toContain(wishlist.visibility);
  });

  it("validates public store search and detail wrappers", async () => {
    const adapter = createSteamStoreAdapter({
      execute,
      searchEnabled: true,
      detailsEnabled: true,
      countryCode: "US",
      language: "english",
    });

    const candidates = await probe("store_search", () =>
      adapter.searchGames("Portal 2", new AbortController().signal),
    );
    const details = await probe("store_details", () =>
      adapter.getStoreGame(publicProbeAppId, new AbortController().signal),
    );

    expect(candidates.length).toBeGreaterThan(0);
    expect(details?.appId).toBe(publicProbeAppId);
  });

  it("validates the public Deck compatibility wrapper", async () => {
    const adapter = createSteamDeckAdapter({ execute, enabled: true });

    const compatibility = await probe("deck", () =>
      adapter.getDeckCompatibility(
        publicProbeAppId,
        new AbortController().signal,
      ),
    );

    expect(compatibility).toBeDefined();
  });

  it("validates the aggregate-only review wrapper", async () => {
    const adapter = createSteamReviewAdapter({ execute, enabled: true });

    const reviews = await probe("reviews", () =>
      adapter.getGameReviews(publicProbeAppId, new AbortController().signal),
    );

    expect(reviews?.totalPositive).toBeGreaterThanOrEqual(0);
  });

  it("validates StoreBrowse tags and the localized vocabulary", async () => {
    const adapter = createSteamTagAdapter({
      execute,
      enabled: true,
      countryCode: "US",
      language: "english",
    });

    const tags = await probe("tags", () =>
      adapter.getGameTags(publicProbeAppId, new AbortController().signal),
    );

    expect(tags?.length).toBeGreaterThan(0);
  });
});
