import { z } from "zod";

import type { AppId } from "../../domain/app-id.js";
import { parseIsoTimestamp } from "../../domain/iso-timestamp.js";
import type {
  GameAchievementDefinition,
  GlobalAchievementPercentage,
  PlayerAchievement,
  PlayerDataCollection,
} from "../../domain/steam-data.js";
import type { SteamId64 } from "../../domain/steam-id.js";
import type { SteamHttpResponse } from "../http/steam-http-client.js";
import {
  buildSteamRequest,
  type SteamHttpRequest,
} from "../http/steam-request.js";
import {
  parseSteamResponse,
  SteamResponseValidationError,
} from "../http/steam-response.js";

const uint32Schema = z.number().int().nonnegative().max(4_294_967_295);
const playerAchievementSchema = z
  .object({
    apiname: z.string().min(1),
    achieved: z.union([z.literal(0), z.literal(1)]),
    unlocktime: uint32Schema,
  })
  .refine(
    (achievement) => achievement.achieved === 1 || achievement.unlocktime === 0,
  );

const playerAchievementsSchema = z.object({
  playerstats: z.discriminatedUnion("success", [
    z.object({
      steamID: z.string().regex(/^\d{17}$/),
      gameName: z.string(),
      achievements: z.array(playerAchievementSchema).optional(),
      success: z.literal(true),
    }),
    z.object({
      steamID: z.string().regex(/^\d{17}$/),
      success: z.literal(false),
      error: z.string().min(1),
    }),
  ]),
});

const gameAchievementSchema = z.object({
  game: z.object({
    gameName: z.string(),
    gameVersion: z.string(),
    availableGameStats: z
      .object({
        achievements: z
          .array(
            z.object({
              name: z.string().min(1),
              defaultvalue: z.number().int(),
              displayName: z.string().optional(),
              hidden: z.union([z.literal(0), z.literal(1)]),
              description: z.string().optional(),
              icon: z.url().optional(),
              icongray: z.url().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
  }),
});

const globalAchievementSchema = z.object({
  achievementpercentages: z.object({
    achievements: z
      .array(
        z.object({
          name: z.string().min(1),
          percent: z.number().min(0).max(100),
        }),
      )
      .refine(
        (achievements) =>
          new Set(achievements.map((achievement) => achievement.name)).size ===
          achievements.length,
      )
      .optional(),
  }),
});

export type SteamAchievementHttpExecutor = (
  request: SteamHttpRequest,
  signal: AbortSignal,
) => Promise<SteamHttpResponse>;

interface SteamAchievementAdapterOptions {
  readonly apiKey: string;
  readonly execute: SteamAchievementHttpExecutor;
}

export function createSteamAchievementAdapter(
  options: SteamAchievementAdapterOptions,
) {
  return {
    async getPlayerAchievements(
      steamId: SteamId64,
      appId: AppId,
      signal: AbortSignal,
    ): Promise<PlayerDataCollection<PlayerAchievement>> {
      const response = await options.execute(
        buildSteamRequest("getPlayerAchievements", {
          key: options.apiKey,
          steamid: steamId,
          appid: String(appId),
          l: "english",
        }),
        signal,
      );
      const parsed = parseSteamResponse(
        response.body,
        playerAchievementsSchema,
      );
      if (parsed.playerstats.steamID !== steamId) {
        throw new SteamResponseValidationError(
          "invalid_shape",
          "Steam returned achievement data for an unexpected account",
        );
      }
      if (!parsed.playerstats.success) {
        if (isPrivateProfileError(parsed.playerstats.error)) {
          return { visibility: "private", items: [] };
        }
        throw new SteamResponseValidationError(
          "invalid_shape",
          "Steam returned unsupported achievement status",
        );
      }
      return {
        visibility: "public",
        items: (parsed.playerstats.achievements ?? []).map((achievement) => ({
          apiName: achievement.apiname,
          achieved: achievement.achieved === 1,
          ...(achievement.unlocktime === 0
            ? {}
            : {
                unlockedAt: parseIsoTimestamp(
                  new Date(achievement.unlocktime * 1_000).toISOString(),
                ),
              }),
        })),
      };
    },
    async getGameAchievementSchema(
      appId: AppId,
      signal: AbortSignal,
    ): Promise<readonly GameAchievementDefinition[]> {
      const response = await options.execute(
        buildSteamRequest("getAchievementSchema", {
          key: options.apiKey,
          appid: String(appId),
          l: "english",
        }),
        signal,
      );
      const parsed = parseSteamResponse(response.body, gameAchievementSchema);
      return (parsed.game.availableGameStats?.achievements ?? []).map(
        (achievement) => ({
          apiName: achievement.name,
          ...(achievement.displayName === undefined
            ? {}
            : { displayName: achievement.displayName }),
          ...(achievement.description === undefined
            ? {}
            : { description: achievement.description }),
          hidden: achievement.hidden === 1,
          ...(achievement.icon === undefined
            ? {}
            : { iconUrl: achievement.icon }),
          ...(achievement.icongray === undefined
            ? {}
            : { lockedIconUrl: achievement.icongray }),
        }),
      );
    },
    async getGlobalAchievementPercentages(
      appId: AppId,
      signal: AbortSignal,
    ): Promise<readonly GlobalAchievementPercentage[]> {
      const response = await options.execute(
        buildSteamRequest("getGlobalAchievementPercentages", {
          gameid: String(appId),
        }),
        signal,
      );
      const parsed = parseSteamResponse(response.body, globalAchievementSchema);
      return (parsed.achievementpercentages.achievements ?? []).map(
        (achievement) => ({
          apiName: achievement.name,
          globalPercent: achievement.percent,
        }),
      );
    },
  };
}

function isPrivateProfileError(error: string): boolean {
  const normalized = error.toLowerCase();
  return normalized.includes("private") || normalized.includes("not public");
}

export function enrichPlayerAchievements(
  progress: readonly PlayerAchievement[],
  definitions: readonly GameAchievementDefinition[],
  percentages: readonly GlobalAchievementPercentage[],
): readonly PlayerAchievement[] {
  const definitionByName = new Map(
    definitions.map((definition) => [definition.apiName, definition]),
  );
  const percentageByName = new Map(
    percentages.map((percentage) => [
      percentage.apiName,
      percentage.globalPercent,
    ]),
  );

  return progress.map((achievement) => {
    const definition = definitionByName.get(achievement.apiName);
    const globalPercent = percentageByName.get(achievement.apiName);
    return {
      apiName: achievement.apiName,
      ...(definition?.displayName === undefined
        ? {}
        : { displayName: definition.displayName }),
      ...(definition?.description === undefined
        ? {}
        : { description: definition.description }),
      achieved: achievement.achieved,
      ...(achievement.unlockedAt === undefined
        ? {}
        : { unlockedAt: achievement.unlockedAt }),
      ...(globalPercent === undefined ? {} : { globalPercent }),
    };
  });
}
