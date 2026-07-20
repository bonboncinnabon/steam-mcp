import { z } from "zod";

import type { AppId } from "../../domain/app-id.js";
import type { DeckCompatibility } from "../../domain/steam-data.js";
import { parseBestEffortResponse } from "../best-effort/best-effort-response.js";
import type { SteamHttpResponse } from "../http/steam-http-client.js";
import {
  buildSteamRequest,
  type SteamHttpRequest,
} from "../http/steam-request.js";
import { OptionalSourceDisabledError } from "../optional-source.js";

const categorySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

function createDeckResponseSchema(appId: AppId) {
  return z.object({
    success: z.literal(1),
    results: z.union([
      z.tuple([]),
      z.object({
        appid: z.literal(appId),
        resolved_category: categorySchema,
        resolved_items: z
          .array(
            z.object({
              display_type: z.number().int(),
              loc_token: z.string().min(1),
            }),
          )
          .max(100)
          .optional(),
      }),
    ]),
  });
}

const CATEGORY_NAMES = [
  "unknown",
  "unsupported",
  "playable",
  "verified",
] as const;

export type SteamDeckHttpExecutor = (
  request: SteamHttpRequest,
  signal: AbortSignal,
) => Promise<SteamHttpResponse>;

interface SteamDeckAdapterOptions {
  readonly execute: SteamDeckHttpExecutor;
  readonly enabled: boolean;
}

export function createSteamDeckAdapter(options: SteamDeckAdapterOptions) {
  return {
    async getDeckCompatibility(
      appId: AppId,
      signal: AbortSignal,
    ): Promise<DeckCompatibility | undefined> {
      if (!options.enabled) {
        throw new OptionalSourceDisabledError();
      }
      const response = await options.execute(
        buildSteamRequest("deckCompatibility", {
          nAppID: String(appId),
        }),
        signal,
      );
      const parsed = parseBestEffortResponse(
        response.body,
        createDeckResponseSchema(appId),
      );
      if (Array.isArray(parsed.results)) {
        return undefined;
      }
      return { category: CATEGORY_NAMES[parsed.results.resolved_category] };
    },
  };
}
