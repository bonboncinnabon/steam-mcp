import type {
  createSteamGetAchievementsService,
  SteamGetAchievementsInput,
} from "../application/services/steam-get-achievements.js";
import type {
  createSteamGetFriendsService,
  SteamGetFriendsInput,
} from "../application/services/steam-get-friends.js";
import type { createSteamGetGameService } from "../application/services/steam-get-game.js";
import type {
  createSteamGetLibraryService,
  SteamGetLibraryInput,
} from "../application/services/steam-get-library.js";
import type { createSteamGetPlayerService } from "../application/services/steam-get-player.js";
import type {
  createSteamGetRecentActivityService,
  SteamGetRecentActivityInput,
} from "../application/services/steam-get-recent-activity.js";
import type {
  createSteamGetWishlistService,
  SteamGetWishlistInput,
} from "../application/services/steam-get-wishlist.js";
import type { createSteamSearchGamesService } from "../application/services/steam-search-games.js";
import type { ResolveSteamIdentityInput } from "../application/services/steam-identity-resolver.js";
import type { z } from "zod";
import { createMcpToolHandler } from "./tool-adapter.js";
import type { STEAM_TOOL_CONTRACTS } from "./tool-contracts.js";
import type { SteamToolBindings, SteamToolName } from "./tool-registry.js";

interface LocalToolServices {
  readonly getPlayer: ReturnType<typeof createSteamGetPlayerService>;
  readonly getLibrary: ReturnType<typeof createSteamGetLibraryService>;
  readonly getRecentActivity: ReturnType<
    typeof createSteamGetRecentActivityService
  >;
  readonly getAchievements: ReturnType<
    typeof createSteamGetAchievementsService
  >;
  readonly getFriends: ReturnType<typeof createSteamGetFriendsService>;
  readonly getWishlist: ReturnType<typeof createSteamGetWishlistService>;
  readonly searchGames: ReturnType<typeof createSteamSearchGamesService>;
  readonly getGame: ReturnType<typeof createSteamGetGameService>;
}

type ToolInput<Name extends SteamToolName> = z.output<
  (typeof STEAM_TOOL_CONTRACTS)[Name]["inputSchema"]
>;

export function createLocalToolBindings(
  services: LocalToolServices,
  configuredDefault?: string,
  executionDeadlineMs?: number,
): SteamToolBindings {
  const boundedSignal = (signal: AbortSignal): AbortSignal =>
    executionDeadlineMs === undefined
      ? signal
      : AbortSignal.any([signal, AbortSignal.timeout(executionDeadlineMs)]);

  return {
    steam_get_player: createMcpToolHandler({
      execute: (input: ToolInput<"steam_get_player">, signal) =>
        services.getPlayer.execute(
          localSubjectInputMappers.steam_get_player(input, configuredDefault),
          boundedSignal(signal),
        ),
      renderSuccess: (data) => `Steam player: ${data.profile.displayName}.`,
    }),
    steam_get_library: createMcpToolHandler({
      execute: (input: ToolInput<"steam_get_library">, signal) =>
        services.getLibrary.execute(
          localSubjectInputMappers.steam_get_library(input, configuredDefault),
          boundedSignal(signal),
        ),
      renderSuccess: (data) =>
        `Steam library: ${String(data.games.length)} of ${String(data.totalCount)} games.`,
    }),
    steam_get_recent_activity: createMcpToolHandler({
      execute: (input: ToolInput<"steam_get_recent_activity">, signal) =>
        services.getRecentActivity.execute(
          localSubjectInputMappers.steam_get_recent_activity(
            input,
            configuredDefault,
          ),
          boundedSignal(signal),
        ),
      renderSuccess: (data) =>
        `Recent Steam activity: ${formatCount(data.recentGames.length, "game")}.`,
    }),
    steam_get_achievements: createMcpToolHandler({
      execute: (input: ToolInput<"steam_get_achievements">, signal) =>
        services.getAchievements.execute(
          localSubjectInputMappers.steam_get_achievements(
            input,
            configuredDefault,
          ),
          boundedSignal(signal),
        ),
      renderSuccess: (data) =>
        `Steam achievements: ${String(data.achievements.length)} of ${String(data.totalCount)}.`,
    }),
    steam_get_friends: createMcpToolHandler({
      execute: (input: ToolInput<"steam_get_friends">, signal) =>
        services.getFriends.execute(
          localSubjectInputMappers.steam_get_friends(input, configuredDefault),
          boundedSignal(signal),
        ),
      renderSuccess: (data) =>
        `Steam friends: ${String(data.friends.length)} of ${String(data.totalCount)}.`,
    }),
    steam_get_wishlist: createMcpToolHandler({
      execute: (input: ToolInput<"steam_get_wishlist">, signal) =>
        services.getWishlist.execute(
          localSubjectInputMappers.steam_get_wishlist(input, configuredDefault),
          boundedSignal(signal),
        ),
      renderSuccess: (data) =>
        `Steam wishlist: ${String(data.items.length)} of ${String(data.totalCount)} games.`,
    }),
    steam_search_games: createMcpToolHandler({
      execute: (input: ToolInput<"steam_search_games">, signal) =>
        services.searchGames.execute(input, boundedSignal(signal)),
      renderSuccess: (data) => {
        const count = data.candidates.length;
        return `Found ${String(count)} Steam ${count === 1 ? "game" : "games"} for "${data.query}".`;
      },
    }),
    steam_get_game: createMcpToolHandler({
      execute: (input: ToolInput<"steam_get_game">, signal) =>
        services.getGame.execute(input, boundedSignal(signal)),
      renderSuccess: (data) =>
        `Steam game: ${data.facets.storeDetails.name} (app ${String(data.appId)}).`,
    }),
  };
}

function mapIdentityInput(
  user: string | undefined,
  configuredDefault: string | undefined,
): ResolveSteamIdentityInput {
  return {
    ...(user === undefined ? {} : { explicitUser: user }),
    ...(configuredDefault === undefined ? {} : { configuredDefault }),
  };
}

export const localSubjectInputMappers = {
  steam_get_player(
    input: ToolInput<"steam_get_player">,
    configuredDefault: string | undefined,
  ): ResolveSteamIdentityInput {
    return mapIdentityInput(input.user, configuredDefault);
  },
  steam_get_library(
    input: ToolInput<"steam_get_library">,
    configuredDefault: string | undefined,
  ): SteamGetLibraryInput {
    return {
      limit: input.limit,
      played: input.played,
      sortBy: input.sortBy,
      sortDirection: input.sortDirection,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.query === undefined ? {} : { query: input.query }),
      ...mapIdentityInput(input.user, configuredDefault),
    };
  },
  steam_get_recent_activity(
    input: ToolInput<"steam_get_recent_activity">,
    configuredDefault: string | undefined,
  ): SteamGetRecentActivityInput {
    return {
      limit: input.limit,
      ...mapIdentityInput(input.user, configuredDefault),
    };
  },
  steam_get_achievements(
    input: ToolInput<"steam_get_achievements">,
    configuredDefault: string | undefined,
  ): SteamGetAchievementsInput {
    return {
      appId: input.appId,
      limit: input.limit,
      state: input.state,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...mapIdentityInput(input.user, configuredDefault),
    };
  },
  steam_get_friends(
    input: ToolInput<"steam_get_friends">,
    configuredDefault: string | undefined,
  ): SteamGetFriendsInput {
    return {
      limit: input.limit,
      includePresence: input.includePresence,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...mapIdentityInput(input.user, configuredDefault),
    };
  },
  steam_get_wishlist(
    input: ToolInput<"steam_get_wishlist">,
    configuredDefault: string | undefined,
  ): SteamGetWishlistInput {
    return {
      limit: input.limit,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...mapIdentityInput(input.user, configuredDefault),
    };
  },
};

function formatCount(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}
