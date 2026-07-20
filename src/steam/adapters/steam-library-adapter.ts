import { z } from "zod";

import { parseAppId } from "../../domain/app-id.js";
import { parseIsoTimestamp } from "../../domain/iso-timestamp.js";
import type {
  OwnedGame,
  PlayerDataCollection,
} from "../../domain/steam-data.js";
import type { SteamId64 } from "../../domain/steam-id.js";
import type { SteamHttpResponse } from "../http/steam-http-client.js";
import {
  buildSteamRequest,
  type SteamHttpRequest,
} from "../http/steam-request.js";
import { parseSteamResponse } from "../http/steam-response.js";

const uint32Schema = z.number().int().nonnegative().max(4_294_967_295);

const gameSchema = z.object({
  appid: uint32Schema.positive(),
  name: z.string().optional(),
  playtime_forever: uint32Schema,
  playtime_2weeks: uint32Schema.optional(),
  rtime_last_played: uint32Schema.optional(),
});

const ownedGamesSchema = z.object({
  response: z.union([
    z
      .object({
        game_count: uint32Schema,
        games: z.array(gameSchema).optional(),
      })
      .refine(
        (response) => (response.games?.length ?? 0) === response.game_count,
      ),
    z.object({}).strict(),
  ]),
});

const recentGamesSchema = z.object({
  response: z.union([
    z
      .object({
        total_count: uint32Schema,
        games: z.array(gameSchema).max(100).optional(),
      })
      .refine(
        (response) => response.total_count >= (response.games?.length ?? 0),
      ),
    z.object({}).strict(),
  ]),
});

export type SteamLibraryHttpExecutor = (
  request: SteamHttpRequest,
  signal: AbortSignal,
) => Promise<SteamHttpResponse>;

interface SteamLibraryAdapterOptions {
  readonly apiKey: string;
  readonly execute: SteamLibraryHttpExecutor;
}

export function createSteamLibraryAdapter(options: SteamLibraryAdapterOptions) {
  return {
    async getOwnedGames(
      steamId: SteamId64,
      signal: AbortSignal,
    ): Promise<PlayerDataCollection<OwnedGame>> {
      const response = await options.execute(
        buildSteamRequest("getOwnedGames", {
          key: options.apiKey,
          steamid: steamId,
          include_appinfo: "1",
          include_played_free_games: "1",
          format: "json",
        }),
        signal,
      );
      const parsed = parseSteamResponse(response.body, ownedGamesSchema);
      if (!("game_count" in parsed.response)) {
        return { visibility: "private", items: [] };
      }
      return {
        visibility: "public",
        items: (parsed.response.games ?? []).map(normalizeGame),
      };
    },
    async getRecentGames(
      steamId: SteamId64,
      signal: AbortSignal,
    ): Promise<PlayerDataCollection<OwnedGame>> {
      const response = await options.execute(
        buildSteamRequest("getRecentlyPlayedGames", {
          key: options.apiKey,
          steamid: steamId,
          count: "100",
          format: "json",
        }),
        signal,
      );
      const parsed = parseSteamResponse(response.body, recentGamesSchema);
      if (!("total_count" in parsed.response)) {
        return { visibility: "private", items: [] };
      }
      return {
        visibility: "public",
        items: (parsed.response.games ?? []).map(normalizeGame),
      };
    },
  };
}

function normalizeGame(game: z.infer<typeof gameSchema>): OwnedGame {
  return {
    appId: parseAppId(game.appid),
    ...(game.name === undefined ? {} : { name: game.name }),
    playtimeMinutes: game.playtime_forever,
    ...(game.playtime_2weeks === undefined
      ? {}
      : { recentPlaytimeMinutes: game.playtime_2weeks }),
    ...(game.rtime_last_played === undefined
      ? {}
      : {
          lastPlayedAt: parseIsoTimestamp(
            new Date(game.rtime_last_played * 1_000).toISOString(),
          ),
        }),
  };
}
