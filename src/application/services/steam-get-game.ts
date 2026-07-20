import { z } from "zod";

import type { SteamDataPort } from "../ports/steam-data.js";
import { parseAppId, type AppId } from "../../domain/app-id.js";
import {
  ERROR_CODES,
  failure,
  success,
  type ErrorCode,
  type SourceTier,
} from "../../domain/result.js";
import type {
  DeckCompatibility,
  GameAchievementDefinition,
  GameNewsItem,
  GameReviewSummary,
  GlobalAchievementPercentage,
  StoreGameDetails,
} from "../../domain/steam-data.js";

export const STEAM_GAME_FACETS = [
  "reviews",
  "current_players",
  "deck_compatibility",
  "news",
  "global_achievements",
] as const;

const steamGameFacetListSchema = z
  .array(z.enum(STEAM_GAME_FACETS))
  .max(STEAM_GAME_FACETS.length)
  .refine((facets) => new Set(facets).size === facets.length);

export type SteamGameFacet = (typeof STEAM_GAME_FACETS)[number];

interface SteamGetGameDependencies {
  readonly steamData: Pick<
    SteamDataPort,
    | "getStoreGame"
    | "getGameReviews"
    | "getCurrentPlayers"
    | "getDeckCompatibility"
    | "getGameNews"
    | "getGameAchievementSchema"
    | "getGlobalAchievementPercentages"
  >;
}

export interface SteamGetGameInput {
  readonly appId: number;
  readonly facets?: readonly SteamGameFacet[];
}

export interface SteamGameFacetData {
  readonly storeDetails: StoreGameDetails;
  readonly reviews?: GameReviewSummary;
  readonly currentPlayers?: number;
  readonly deckCompatibility?: DeckCompatibility;
  readonly news?: readonly GameNewsItem[];
  readonly globalAchievements?: Readonly<{
    definitions: readonly GameAchievementDefinition[];
    percentages: readonly GlobalAchievementPercentage[];
  }>;
}

export interface UnavailableGameFacet {
  readonly facet: SteamGameFacet;
  readonly sourceTier: SourceTier;
  readonly code: ErrorCode;
}

export interface SteamGameResult {
  readonly appId: AppId;
  readonly facets: SteamGameFacetData;
  readonly unavailableFacets: readonly UnavailableGameFacet[];
}

export function createSteamGetGameService(
  dependencies: SteamGetGameDependencies,
) {
  return {
    async execute(input: SteamGetGameInput, signal: AbortSignal) {
      const parsedFacets = steamGameFacetListSchema.safeParse(
        input.facets ?? [],
      );
      if (!parsedFacets.success) {
        return failure("INVALID_INPUT", "Invalid Steam game facet", false);
      }
      let appId: AppId;
      try {
        appId = parseAppId(input.appId);
      } catch {
        return failure("INVALID_INPUT", "Invalid Steam app ID", false);
      }
      const storeDetails = await dependencies.steamData.getStoreGame(
        appId,
        signal,
      );
      if (storeDetails === undefined) {
        return failure("NOT_FOUND", "Steam app was not found", false);
      }
      const selectedFacets = new Set(parsedFacets.data);
      const unavailableFacets: UnavailableGameFacet[] = [];
      const warnings: string[] = [];
      let reviews: GameReviewSummary | undefined;
      if (selectedFacets.has("reviews")) {
        try {
          reviews = await dependencies.steamData.getGameReviews(appId, signal);
          if (reviews === undefined) {
            unavailableFacets.push({
              facet: "reviews",
              sourceTier: "best_effort",
              code: "NOT_FOUND",
            });
            warnings.push("Reviews are unavailable (NOT_FOUND).");
          }
        } catch (error) {
          if (signal.aborted) {
            throw error;
          }
          const code = errorCode(error);
          unavailableFacets.push({
            facet: "reviews",
            sourceTier: "best_effort",
            code,
          });
          warnings.push(`Reviews are unavailable (${code}).`);
        }
      }
      const currentPlayers = selectedFacets.has("current_players")
        ? await dependencies.steamData.getCurrentPlayers(appId, signal)
        : undefined;
      let deckCompatibility: DeckCompatibility | undefined;
      if (selectedFacets.has("deck_compatibility")) {
        try {
          deckCompatibility = await dependencies.steamData.getDeckCompatibility(
            appId,
            signal,
          );
          if (deckCompatibility === undefined) {
            unavailableFacets.push({
              facet: "deck_compatibility",
              sourceTier: "best_effort",
              code: "NOT_FOUND",
            });
            warnings.push(
              "Steam Deck compatibility is unavailable (NOT_FOUND).",
            );
          }
        } catch (error) {
          if (signal.aborted) {
            throw error;
          }
          const code = errorCode(error);
          unavailableFacets.push({
            facet: "deck_compatibility",
            sourceTier: "best_effort",
            code,
          });
          warnings.push(`Steam Deck compatibility is unavailable (${code}).`);
        }
      }
      const news = selectedFacets.has("news")
        ? await dependencies.steamData.getGameNews(appId, signal)
        : undefined;
      const globalAchievements = selectedFacets.has("global_achievements")
        ? {
            definitions: await dependencies.steamData.getGameAchievementSchema(
              appId,
              signal,
            ),
            percentages:
              await dependencies.steamData.getGlobalAchievementPercentages(
                appId,
                signal,
              ),
          }
        : undefined;
      const includesSupportedFacet =
        selectedFacets.has("current_players") ||
        selectedFacets.has("news") ||
        selectedFacets.has("global_achievements");

      return success<SteamGameResult>(
        {
          appId,
          facets: {
            storeDetails,
            ...(reviews === undefined ? {} : { reviews }),
            ...(currentPlayers === undefined ? {} : { currentPlayers }),
            ...(deckCompatibility === undefined ? {} : { deckCompatibility }),
            ...(news === undefined ? {} : { news }),
            ...(globalAchievements === undefined ? {} : { globalAchievements }),
          },
          unavailableFacets,
        },
        includesSupportedFacet ? ["supported", "best_effort"] : ["best_effort"],
        { partial: unavailableFacets.length > 0, warnings },
      );
    },
  };
}

function errorCode(error: unknown): ErrorCode {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    ERROR_CODES.includes(error.code as ErrorCode)
  ) {
    return error.code as ErrorCode;
  }
  return "UPSTREAM_UNAVAILABLE";
}
