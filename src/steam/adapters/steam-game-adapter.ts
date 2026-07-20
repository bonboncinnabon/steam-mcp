import { z } from "zod";

import type { AppId } from "../../domain/app-id.js";
import { parseIsoTimestamp } from "../../domain/iso-timestamp.js";
import type { GameNewsItem } from "../../domain/steam-data.js";
import type { SteamHttpResponse } from "../http/steam-http-client.js";
import {
  buildSteamRequest,
  type SteamHttpRequest,
} from "../http/steam-request.js";
import { parseSteamResponse } from "../http/steam-response.js";

const currentPlayersSchema = z.object({
  response: z.object({
    player_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    result: z.literal(1),
  }),
});

const uint32Schema = z.number().int().nonnegative().max(4_294_967_295);

export type SteamGameHttpExecutor = (
  request: SteamHttpRequest,
  signal: AbortSignal,
) => Promise<SteamHttpResponse>;

interface SteamGameAdapterOptions {
  readonly execute: SteamGameHttpExecutor;
  readonly maxNewsItems: number;
}

export function createSteamGameAdapter(options: SteamGameAdapterOptions) {
  if (
    !Number.isInteger(options.maxNewsItems) ||
    options.maxNewsItems < 1 ||
    options.maxNewsItems > 200
  ) {
    throw new RangeError("News item limit must be between 1 and 200");
  }

  return {
    async getCurrentPlayers(
      appId: AppId,
      signal: AbortSignal,
    ): Promise<number> {
      const response = await options.execute(
        buildSteamRequest("getCurrentPlayers", { appid: String(appId) }),
        signal,
      );
      const parsed = parseSteamResponse(response.body, currentPlayersSchema);
      return parsed.response.player_count;
    },
    async getGameNews(
      appId: AppId,
      signal: AbortSignal,
    ): Promise<readonly GameNewsItem[]> {
      const response = await options.execute(
        buildSteamRequest("getGameNews", {
          appid: String(appId),
          count: String(options.maxNewsItems),
          maxlength: "1",
        }),
        signal,
      );
      const parsed = parseSteamResponse(
        response.body,
        createGameNewsSchema(appId, options.maxNewsItems),
      );
      return parsed.appnews.newsitems.map((item) => ({
        id: item.gid,
        title: item.title,
        url: item.url,
        publishedAt: parseIsoTimestamp(
          new Date(item.date * 1_000).toISOString(),
        ),
      }));
    },
  };
}

function createGameNewsSchema(appId: AppId, maxItems: number) {
  return z.object({
    appnews: z
      .object({
        appid: z.literal(appId),
        newsitems: z
          .array(
            z.object({
              gid: z.string().min(1),
              title: z.string(),
              url: z.url(),
              date: uint32Schema,
              appid: z.literal(appId),
            }),
          )
          .max(maxItems),
        count: uint32Schema,
      })
      .refine((appNews) => appNews.count >= appNews.newsitems.length),
  });
}
