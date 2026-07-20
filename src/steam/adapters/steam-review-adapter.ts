import { z } from "zod";

import type { AppId } from "../../domain/app-id.js";
import type { GameReviewSummary } from "../../domain/steam-data.js";
import { parseBestEffortResponse } from "../best-effort/best-effort-response.js";
import type { SteamHttpResponse } from "../http/steam-http-client.js";
import {
  buildSteamAppReviewsRequest,
  type SteamHttpRequest,
} from "../http/steam-request.js";
import { OptionalSourceDisabledError } from "../optional-source.js";

const safeCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const reviewSummarySchema = z.object({
  success: z.literal(1),
  query_summary: z
    .object({
      num_reviews: z.literal(0),
      review_score: z.number().int().min(0).max(9),
      review_score_desc: z.string().min(1),
      total_positive: safeCountSchema,
      total_negative: safeCountSchema,
      total_reviews: safeCountSchema,
    })
    .refine(
      (summary) =>
        summary.total_positive <= summary.total_reviews &&
        summary.total_negative ===
          summary.total_reviews - summary.total_positive,
    ),
  reviews: z.array(z.unknown()).max(0).optional(),
});

export type SteamReviewHttpExecutor = (
  request: SteamHttpRequest,
  signal: AbortSignal,
) => Promise<SteamHttpResponse>;

interface SteamReviewAdapterOptions {
  readonly execute: SteamReviewHttpExecutor;
  readonly enabled: boolean;
}

export function createSteamReviewAdapter(options: SteamReviewAdapterOptions) {
  return {
    async getGameReviews(
      appId: AppId,
      signal: AbortSignal,
    ): Promise<GameReviewSummary | undefined> {
      if (!options.enabled) {
        throw new OptionalSourceDisabledError();
      }
      const response = await options.execute(
        buildSteamAppReviewsRequest(appId),
        signal,
      );
      const summary = parseBestEffortResponse(
        response.body,
        reviewSummarySchema,
      );
      return {
        totalPositive: summary.query_summary.total_positive,
        totalNegative: summary.query_summary.total_negative,
        scoreDescription: summary.query_summary.review_score_desc,
      };
    },
  };
}
