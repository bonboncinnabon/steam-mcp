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
  localDefault?: string,
): SteamToolBindings {
  return {
    steam_get_player: createMcpToolHandler({
      execute: (input: ToolInput<"steam_get_player">, signal) =>
        services.getPlayer.execute(
          mapSubjectInput(input, localDefault),
          signal,
        ),
      renderSuccess: (data) => `Steam player: ${data.profile.displayName}.`,
    }),
    steam_get_library: createMcpToolHandler({
      execute: (input: ToolInput<"steam_get_library">, signal) =>
        services.getLibrary.execute(
          mapSubjectInput(input, localDefault) as SteamGetLibraryInput,
          signal,
        ),
      renderSuccess: (data) =>
        `Steam library: ${String(data.games.length)} of ${String(data.totalCount)} games.`,
    }),
    steam_get_recent_activity: createMcpToolHandler({
      execute: (input: ToolInput<"steam_get_recent_activity">, signal) =>
        services.getRecentActivity.execute(
          mapSubjectInput(input, localDefault) as SteamGetRecentActivityInput,
          signal,
        ),
      renderSuccess: (data) =>
        `Recent Steam activity: ${formatCount(data.recentGames.length, "game")}.`,
    }),
    steam_get_achievements: createMcpToolHandler({
      execute: (input: ToolInput<"steam_get_achievements">, signal) =>
        services.getAchievements.execute(
          mapSubjectInput(input, localDefault) as SteamGetAchievementsInput,
          signal,
        ),
      renderSuccess: (data) =>
        `Steam achievements: ${String(data.achievements.length)} of ${String(data.totalCount)}.`,
    }),
    steam_get_friends: createMcpToolHandler({
      execute: (input: ToolInput<"steam_get_friends">, signal) =>
        services.getFriends.execute(
          mapSubjectInput(input, localDefault) as SteamGetFriendsInput,
          signal,
        ),
      renderSuccess: (data) =>
        `Steam friends: ${String(data.friends.length)} of ${String(data.totalCount)}.`,
    }),
    steam_get_wishlist: createMcpToolHandler({
      execute: (input: ToolInput<"steam_get_wishlist">, signal) =>
        services.getWishlist.execute(
          mapSubjectInput(input, localDefault) as SteamGetWishlistInput,
          signal,
        ),
      renderSuccess: (data) =>
        `Steam wishlist: ${String(data.items.length)} of ${String(data.totalCount)} games.`,
    }),
    steam_search_games: createMcpToolHandler({
      execute: (input: ToolInput<"steam_search_games">, signal) =>
        services.searchGames.execute(input, signal),
      renderSuccess: (data) => {
        const count = data.candidates.length;
        return `Found ${String(count)} Steam ${count === 1 ? "game" : "games"} for "${data.query}".`;
      },
    }),
    steam_get_game: createMcpToolHandler({
      execute: (input: ToolInput<"steam_get_game">, signal) =>
        services.getGame.execute(input, signal),
      renderSuccess: (data) =>
        `Steam game: ${data.facets.storeDetails.name} (app ${String(data.appId)}).`,
    }),
  };
}

function mapSubjectInput<Input extends { readonly user?: string | undefined }>(
  input: Input,
  localDefault: string | undefined,
): Omit<Input, "user"> & ResolveSteamIdentityInput {
  const { user, ...serviceInput } = input;
  return {
    ...serviceInput,
    ...(user === undefined ? {} : { explicitUser: user }),
    ...(localDefault === undefined ? {} : { localDefault }),
  };
}

function formatCount(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}
