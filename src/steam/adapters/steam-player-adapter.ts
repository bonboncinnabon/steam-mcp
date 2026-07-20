import { z } from "zod";

import { parseAppId } from "../../domain/app-id.js";
import { parseIsoTimestamp } from "../../domain/iso-timestamp.js";
import type {
  PlayerBanSummary,
  PlayerSummary,
} from "../../domain/steam-data.js";
import { parseSteamId64, type SteamId64 } from "../../domain/steam-id.js";
import type { SteamHttpResponse } from "../http/steam-http-client.js";
import {
  buildSteamRequest,
  type SteamHttpRequest,
} from "../http/steam-request.js";
import { parseSteamResponse } from "../http/steam-response.js";

const appIdStringSchema = z
  .string()
  .regex(/^\d+$/)
  .refine((value) => {
    const appId = Number(value);
    return Number.isSafeInteger(appId) && appId > 0 && appId <= 4_294_967_295;
  });

const playerSummariesSchema = z.object({
  response: z.object({
    players: z.array(
      z.object({
        steamid: z.string().regex(/^\d{17}$/),
        communityvisibilitystate: z.number().int(),
        personaname: z.string(),
        profileurl: z.url(),
        avatarfull: z.url().optional(),
        personastate: z.number().int(),
        gameid: appIdStringSchema.optional(),
        lastlogoff: z
          .number()
          .int()
          .nonnegative()
          .max(8_640_000_000_000)
          .optional(),
      }),
    ),
  }),
});

const playerBansSchema = z.object({
  players: z.array(
    z.object({
      SteamId: z.string().regex(/^\d{17}$/),
      CommunityBanned: z.boolean(),
      VACBanned: z.boolean(),
      NumberOfVACBans: z.number().int().nonnegative(),
      DaysSinceLastBan: z.number().int().nonnegative(),
      NumberOfGameBans: z.number().int().nonnegative(),
      EconomyBan: z.enum(["none", "probation", "banned"]),
    }),
  ),
});

export type SteamPlayerHttpExecutor = (
  request: SteamHttpRequest,
  signal: AbortSignal,
) => Promise<SteamHttpResponse>;

interface SteamPlayerAdapterOptions {
  readonly apiKey: string;
  readonly execute: SteamPlayerHttpExecutor;
}

export function createSteamPlayerAdapter(options: SteamPlayerAdapterOptions) {
  return {
    async getPlayers(
      steamIds: readonly SteamId64[],
      signal: AbortSignal,
    ): Promise<readonly PlayerSummary[]> {
      if (steamIds.length === 0) {
        return [];
      }
      assertPlayerBatchBound(steamIds);
      const response = await options.execute(
        buildSteamRequest("getPlayerSummaries", {
          key: options.apiKey,
          steamids: steamIds.join(","),
        }),
        signal,
      );
      const parsed = parseSteamResponse(response.body, playerSummariesSchema);
      return parsed.response.players.map((player) => ({
        steamId: parseSteamId64(player.steamid),
        displayName: player.personaname,
        profileUrl: player.profileurl,
        ...(player.avatarfull === undefined
          ? {}
          : { avatarUrl: player.avatarfull }),
        visibility:
          player.communityvisibilitystate === 3 ? "public" : "private",
        onlineState: normalizePersonaState(player.personastate),
        ...(player.gameid === undefined
          ? {}
          : { currentAppId: parseAppId(Number(player.gameid)) }),
        ...(player.lastlogoff === undefined
          ? {}
          : {
              lastLogoffAt: parseIsoTimestamp(
                new Date(player.lastlogoff * 1_000).toISOString(),
              ),
            }),
      }));
    },
    async getPlayerBans(
      steamIds: readonly SteamId64[],
      signal: AbortSignal,
    ): Promise<readonly PlayerBanSummary[]> {
      if (steamIds.length === 0) {
        return [];
      }
      assertPlayerBatchBound(steamIds);
      const response = await options.execute(
        buildSteamRequest("getPlayerBans", {
          key: options.apiKey,
          steamids: steamIds.join(","),
        }),
        signal,
      );
      const parsed = parseSteamResponse(response.body, playerBansSchema);
      return parsed.players.map((player) => ({
        steamId: parseSteamId64(player.SteamId),
        communityBanned: player.CommunityBanned,
        vacBanCount: player.NumberOfVACBans,
        gameBanCount: player.NumberOfGameBans,
        economyBan: player.EconomyBan,
      }));
    },
  };
}

function assertPlayerBatchBound(steamIds: readonly SteamId64[]): void {
  if (steamIds.length > 100) {
    throw new RangeError("Steam player batch exceeds 100 IDs");
  }
}

function normalizePersonaState(
  state: number,
): "offline" | "online" | "busy" | "away" {
  if (state === 1) {
    return "online";
  }
  if (state === 2) {
    return "busy";
  }
  if (state >= 3 && state <= 6) {
    return "away";
  }
  return "offline";
}
