import { z } from "zod";

import { parseSteamId64, type SteamId64 } from "../../domain/steam-id.js";
import type { SteamHttpResponse } from "../http/steam-http-client.js";
import {
  buildSteamRequest,
  type SteamHttpRequest,
} from "../http/steam-request.js";
import { parseSteamResponse } from "../http/steam-response.js";

const vanityResponseSchema = z.object({
  response: z.discriminatedUnion("success", [
    z.object({
      steamid: z.string().regex(/^\d{17}$/),
      success: z.literal(1),
    }),
    z.object({
      success: z.literal(42),
      message: z.string(),
    }),
  ]),
});

export type SteamVanityHttpExecutor = (
  request: SteamHttpRequest,
  signal: AbortSignal,
) => Promise<SteamHttpResponse>;

interface SteamVanityAdapterOptions {
  readonly apiKey: string;
  readonly execute: SteamVanityHttpExecutor;
}

export function createSteamVanityAdapter(options: SteamVanityAdapterOptions) {
  return {
    async resolveVanityName(
      vanityName: string,
      signal: AbortSignal,
    ): Promise<SteamId64 | undefined> {
      const response = await options.execute(
        buildSteamRequest("resolveVanityUrl", {
          key: options.apiKey,
          vanityurl: vanityName,
        }),
        signal,
      );
      const resolved = parseSteamResponse(response.body, vanityResponseSchema);
      if (resolved.response.success === 42) {
        return undefined;
      }
      return parseSteamId64(resolved.response.steamid);
    },
  };
}
