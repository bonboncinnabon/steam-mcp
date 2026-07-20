import { describe, expect, it, vi } from "vitest";

import { parseAppId } from "../../../src/domain/app-id.js";
import {
  createSteamReviewAdapter,
  type SteamReviewHttpExecutor,
} from "../../../src/steam/adapters/steam-review-adapter.js";

describe("Steam review adapter", () => {
  it("normalizes the supported aggregate review summary", async () => {
    const execute = vi.fn<SteamReviewHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          success: 1,
          query_summary: {
            num_reviews: 0,
            review_score: 9,
            review_score_desc: "Overwhelmingly Positive",
            total_positive: 409_876,
            total_negative: 8_123,
            total_reviews: 417_999,
          },
          reviews: [],
          cursor: "*",
        }),
      ),
      finalUrl: "https://store.steampowered.com/appreviews/620",
    });
    const adapter = createSteamReviewAdapter({ execute, enabled: true });
    const signal = new AbortController().signal;

    await expect(
      adapter.getGameReviews(parseAppId(620), signal),
    ).resolves.toEqual({
      totalPositive: 409_876,
      totalNegative: 8_123,
      scoreDescription: "Overwhelmingly Positive",
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://store.steampowered.com/appreviews/620?json=1&language=all&purchase_type=all&num_per_page=0",
      }),
      signal,
    );
  });

  it("disables reviews without issuing upstream work", async () => {
    const execute = vi.fn<SteamReviewHttpExecutor>();
    const adapter = createSteamReviewAdapter({ execute, enabled: false });

    await expect(
      adapter.getGameReviews(parseAppId(620), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("classifies aggregate-review invocation drift as best-effort", async () => {
    const execute = vi.fn<SteamReviewHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({ success: 0, query_summary: {} }),
      ),
      finalUrl: "https://store.steampowered.com/appreviews/620",
    });
    const adapter = createSteamReviewAdapter({ execute, enabled: true });

    await expect(
      adapter.getGameReviews(parseAppId(620), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "BEST_EFFORT_SOURCE_CHANGED",
      retryable: false,
    });
  });

  it("preserves a valid zero-review aggregate", async () => {
    const execute = vi.fn<SteamReviewHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        JSON.stringify({
          success: 1,
          query_summary: {
            num_reviews: 0,
            review_score: 0,
            review_score_desc: "No user reviews",
            total_positive: 0,
            total_negative: 0,
            total_reviews: 0,
          },
          reviews: [],
        }),
      ),
      finalUrl: "https://store.steampowered.com/appreviews/10",
    });
    const adapter = createSteamReviewAdapter({ execute, enabled: true });

    await expect(
      adapter.getGameReviews(parseAppId(10), new AbortController().signal),
    ).resolves.toEqual({
      totalPositive: 0,
      totalNegative: 0,
      scoreDescription: "No user reviews",
    });
  });

  it.each([
    [
      "inconsistent totals",
      {
        num_reviews: 0,
        review_score: 8,
        review_score_desc: "Very Positive",
        total_positive: 80,
        total_negative: 10,
        total_reviews: 100,
      },
      [],
    ],
    [
      "a returned review record",
      {
        num_reviews: 0,
        review_score: 8,
        review_score_desc: "Very Positive",
        total_positive: 80,
        total_negative: 20,
        total_reviews: 100,
      },
      [{ review: "must never cross this aggregate boundary" }],
    ],
    [
      "a nonzero page count",
      {
        num_reviews: 1,
        review_score: 8,
        review_score_desc: "Very Positive",
        total_positive: 80,
        total_negative: 20,
        total_reviews: 100,
      },
      [],
    ],
  ])(
    "rejects %s from the aggregate-only contract",
    async (_case, summary, reviews) => {
      const execute = vi.fn<SteamReviewHttpExecutor>().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        body: new TextEncoder().encode(
          JSON.stringify({ success: 1, query_summary: summary, reviews }),
        ),
        finalUrl: "https://store.steampowered.com/appreviews/620",
      });
      const adapter = createSteamReviewAdapter({ execute, enabled: true });

      await expect(
        adapter.getGameReviews(parseAppId(620), new AbortController().signal),
      ).rejects.toMatchObject({
        code: "BEST_EFFORT_SOURCE_CHANGED",
        retryable: false,
      });
    },
  );
});
