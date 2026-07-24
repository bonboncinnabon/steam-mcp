import { z } from "zod";

import {
  decodeOpaqueCursor,
  encodeOpaqueCursor,
} from "../pagination/opaque-cursor.js";
import type { SteamDataPort } from "../ports/steam-data.js";
import { parseAppId, type AppId } from "../../domain/app-id.js";
import { enrichPlayerAchievements } from "../../domain/achievement-enrichment.js";
import type { PaginationCursor } from "../../domain/pagination-cursor.js";
import { failure, success } from "../../domain/result.js";
import type { PlayerAchievement } from "../../domain/steam-data.js";
import type { SteamId64 } from "../../domain/steam-id.js";
import type {
  ResolveSteamIdentityInput,
  SteamIdentityResolver,
} from "./steam-identity-resolver.js";
import { SteamIdentityResolutionError } from "./steam-identity-resolver.js";

const achievementStateSchema = z.enum(["all", "locked", "unlocked"]);
type AchievementState = z.infer<typeof achievementStateSchema>;

const achievementCursorSchema = z.object({
  version: z.literal(1),
  steamId: z.string(),
  appId: z.number().int().positive().max(4_294_967_295),
  state: achievementStateSchema,
  offset: z.number().int().nonnegative(),
});

type AchievementCursorPayload = z.infer<typeof achievementCursorSchema>;

interface SteamGetAchievementsDependencies {
  readonly identityResolver: SteamIdentityResolver;
  readonly steamData: Pick<
    SteamDataPort,
    | "getPlayerAchievements"
    | "getGameAchievementSchema"
    | "getGlobalAchievementPercentages"
  >;
  readonly maxPageSize: number;
}

export interface SteamGetAchievementsInput extends ResolveSteamIdentityInput {
  readonly appId: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly state?: AchievementState;
}

export interface SteamAchievementPage {
  readonly steamId: SteamId64;
  readonly appId: AppId;
  readonly achievements: readonly PlayerAchievement[];
  readonly totalCount: number;
  readonly nextCursor?: PaginationCursor;
}

export function createSteamGetAchievementsService(
  dependencies: SteamGetAchievementsDependencies,
) {
  if (
    !Number.isInteger(dependencies.maxPageSize) ||
    dependencies.maxPageSize < 1
  ) {
    throw new RangeError("Achievement maximum page size must be positive");
  }

  return {
    async execute(input: SteamGetAchievementsInput, signal: AbortSignal) {
      let appId: AppId;
      try {
        appId = parseAppId(input.appId);
      } catch {
        return failure("INVALID_INPUT", "Invalid Steam app ID", false);
      }
      if (
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > dependencies.maxPageSize
      ) {
        return failure(
          "INVALID_INPUT",
          "Achievement limit is outside the configured bounds",
          false,
        );
      }
      const stateResult = achievementStateSchema.safeParse(
        input.state ?? "all",
      );
      if (!stateResult.success) {
        return failure("INVALID_INPUT", "Invalid achievement state", false);
      }
      const state = stateResult.data;
      let cursor: AchievementCursorPayload | undefined;
      try {
        cursor =
          input.cursor === undefined
            ? undefined
            : decodeOpaqueCursor(input.cursor, achievementCursorSchema);
      } catch {
        return failure("INVALID_INPUT", "Invalid achievement cursor", false);
      }
      const identityInput: ResolveSteamIdentityInput = {
        ...(input.explicitUser === undefined
          ? {}
          : { explicitUser: input.explicitUser }),
        ...(input.configuredDefault === undefined
          ? {}
          : { configuredDefault: input.configuredDefault }),
      };
      let identity;
      try {
        identity = await dependencies.identityResolver.resolve(
          identityInput,
          signal,
        );
      } catch (error) {
        if (error instanceof SteamIdentityResolutionError) {
          return failure(error.code, error.message, error.retryable);
        }
        throw error;
      }
      if (
        cursor !== undefined &&
        (cursor.steamId !== identity.steamId ||
          cursor.appId !== appId ||
          cursor.state !== state)
      ) {
        return failure(
          "INVALID_INPUT",
          "Achievement cursor does not match this request",
          false,
        );
      }
      const progress = await dependencies.steamData.getPlayerAchievements(
        identity.steamId,
        appId,
        signal,
      );
      if (progress.visibility === "private") {
        return failure(
          "PROFILE_PRIVATE",
          "This Steam profile does not expose achievements for this game",
          false,
        );
      }
      if (progress.items.length === 0) {
        if (cursor !== undefined) {
          return failure(
            "INVALID_INPUT",
            "Achievement cursor is out of range",
            false,
          );
        }
        return success<SteamAchievementPage>(
          {
            steamId: identity.steamId,
            appId,
            achievements: [],
            totalCount: 0,
          },
          ["supported"],
          {
            partial: false,
            warnings: ["This game exposes no achievements."],
          },
        );
      }
      const [definitionsResult, percentagesResult] = await Promise.allSettled([
        dependencies.steamData.getGameAchievementSchema(appId, signal),
        dependencies.steamData.getGlobalAchievementPercentages(appId, signal),
      ]);
      const definitions =
        definitionsResult.status === "fulfilled" ? definitionsResult.value : [];
      const percentages =
        percentagesResult.status === "fulfilled" ? percentagesResult.value : [];
      const warnings = [
        ...(definitionsResult.status === "rejected"
          ? ["Achievement display metadata is unavailable."]
          : []),
        ...(percentagesResult.status === "rejected"
          ? ["Global achievement rarity is unavailable."]
          : []),
      ];
      const achievements = enrichPlayerAchievements(
        progress.items,
        definitions,
        percentages,
      ).filter((achievement) => matchesState(achievement, state));
      const offset = cursor?.offset ?? 0;
      if (offset > achievements.length) {
        return failure(
          "INVALID_INPUT",
          "Achievement cursor is out of range",
          false,
        );
      }
      const page = achievements.slice(offset, offset + input.limit);
      const nextOffset = offset + page.length;
      const nextCursor =
        nextOffset < achievements.length
          ? encodeOpaqueCursor({
              version: 1,
              steamId: identity.steamId,
              appId,
              state,
              offset: nextOffset,
            })
          : undefined;
      return success<SteamAchievementPage>(
        {
          steamId: identity.steamId,
          appId,
          achievements: page,
          totalCount: achievements.length,
          ...(nextCursor === undefined ? {} : { nextCursor }),
        },
        ["supported"],
        { partial: warnings.length > 0, warnings },
      );
    },
  };
}

function matchesState(
  achievement: PlayerAchievement,
  state: AchievementState,
): boolean {
  return (
    state === "all" ||
    (state === "unlocked" && achievement.achieved) ||
    (state === "locked" && !achievement.achieved)
  );
}
