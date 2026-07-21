import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createSteamGetAchievementsService } from "../application/services/steam-get-achievements.js";
import { createSteamGetFriendsService } from "../application/services/steam-get-friends.js";
import { createSteamGetGameService } from "../application/services/steam-get-game.js";
import { createSteamGetLibraryService } from "../application/services/steam-get-library.js";
import { createSteamGetPlayerService } from "../application/services/steam-get-player.js";
import { createSteamGetRecentActivityService } from "../application/services/steam-get-recent-activity.js";
import { createSteamGetWishlistService } from "../application/services/steam-get-wishlist.js";
import { createSteamIdentityResolver } from "../application/services/steam-identity-resolver.js";
import { createSteamSearchGamesService } from "../application/services/steam-search-games.js";
import { parseCurrencyCode } from "../domain/currency.js";
import type { ServicePolicy } from "../domain/service-policy.js";
import { createLocalToolBindings } from "../mcp/local-tool-bindings.js";
import { createSteamToolContracts } from "../mcp/tool-contracts.js";
import { registerSteamTools } from "../mcp/tool-registry.js";
import { createSteamAchievementAdapter } from "../steam/adapters/steam-achievement-adapter.js";
import { createSteamDeckAdapter } from "../steam/adapters/steam-deck-adapter.js";
import { createSteamFriendAdapter } from "../steam/adapters/steam-friend-adapter.js";
import { createSteamGameAdapter } from "../steam/adapters/steam-game-adapter.js";
import { createSteamLibraryAdapter } from "../steam/adapters/steam-library-adapter.js";
import { createSteamPlayerAdapter } from "../steam/adapters/steam-player-adapter.js";
import { createSteamReviewAdapter } from "../steam/adapters/steam-review-adapter.js";
import { createSteamStoreAdapter } from "../steam/adapters/steam-store-adapter.js";
import { createSteamVanityAdapter } from "../steam/adapters/steam-vanity-adapter.js";
import { createSteamWishlistAdapter } from "../steam/adapters/steam-wishlist-adapter.js";
import type { SteamHttpResponse } from "../steam/http/steam-http-client.js";
import type { SteamHttpRequest } from "../steam/http/steam-request.js";

export interface BestEffortSourcePolicy {
  readonly wishlist: boolean;
  readonly storeSearch: boolean;
  readonly storeDetails: boolean;
  readonly deckCompatibility: boolean;
  readonly gameReviews: boolean;
}

export const ENABLED_BEST_EFFORT_SOURCES: BestEffortSourcePolicy =
  Object.freeze({
    wishlist: true,
    storeSearch: true,
    storeDetails: true,
    deckCompatibility: true,
    gameReviews: true,
  });

export type SteamRequestExecutor = (
  request: SteamHttpRequest,
  signal: AbortSignal,
) => Promise<SteamHttpResponse>;

interface SteamMcpServerOptions {
  readonly steamApiKey: string;
  readonly policy: ServicePolicy;
  readonly execute: SteamRequestExecutor;
  readonly localDefault?: string;
  readonly bestEffortSources?: BestEffortSourcePolicy;
}

const STOREFRONT = Object.freeze({
  countryCode: "US",
  currency: parseCurrencyCode("USD"),
  language: "english",
});

export function createSteamMcpServer(
  options: SteamMcpServerOptions,
): McpServer {
  const bestEffort = options.bestEffortSources ?? ENABLED_BEST_EFFORT_SOURCES;
  const vanity = createSteamVanityAdapter({
    apiKey: options.steamApiKey,
    execute: options.execute,
  });
  const player = createSteamPlayerAdapter({
    apiKey: options.steamApiKey,
    execute: options.execute,
  });
  const library = createSteamLibraryAdapter({
    apiKey: options.steamApiKey,
    execute: options.execute,
  });
  const achievements = createSteamAchievementAdapter({
    apiKey: options.steamApiKey,
    execute: options.execute,
  });
  const friends = createSteamFriendAdapter({
    apiKey: options.steamApiKey,
    execute: options.execute,
  });
  const wishlist = createSteamWishlistAdapter({
    execute: options.execute,
    enabled: bestEffort.wishlist,
    ...STOREFRONT,
    maxPageSize: options.policy.maxPageSize,
  });
  const store = createSteamStoreAdapter({
    execute: options.execute,
    searchEnabled: bestEffort.storeSearch,
    detailsEnabled: bestEffort.storeDetails,
    countryCode: STOREFRONT.countryCode,
    language: STOREFRONT.language,
  });
  const game = createSteamGameAdapter({
    execute: options.execute,
    maxNewsItems: options.policy.maxPageSize,
  });
  const reviews = createSteamReviewAdapter({
    execute: options.execute,
    enabled: bestEffort.gameReviews,
  });
  const deck = createSteamDeckAdapter({
    execute: options.execute,
    enabled: bestEffort.deckCompatibility,
  });
  const steamData = {
    ...vanity,
    ...player,
    ...library,
    ...achievements,
    ...friends,
    ...wishlist,
    ...store,
    ...game,
    ...reviews,
    ...deck,
  };
  const identityResolver = createSteamIdentityResolver({
    steamIdentities: steamData,
  });
  const services = {
    getPlayer: createSteamGetPlayerService({ identityResolver, steamData }),
    getLibrary: createSteamGetLibraryService({
      identityResolver,
      steamData,
      maxPageSize: options.policy.maxPageSize,
    }),
    getRecentActivity: createSteamGetRecentActivityService({
      identityResolver,
      steamData,
      maxItems: options.policy.maxPageSize,
    }),
    getAchievements: createSteamGetAchievementsService({
      identityResolver,
      steamData,
      maxPageSize: options.policy.maxPageSize,
    }),
    getFriends: createSteamGetFriendsService({
      identityResolver,
      steamData,
      maxPageSize: options.policy.maxPageSize,
      maxPresenceProfiles: Math.min(options.policy.maxToolFanOut, 100),
    }),
    getWishlist: createSteamGetWishlistService({
      identityResolver,
      steamData,
      maxPageSize: options.policy.maxPageSize,
    }),
    searchGames: createSteamSearchGamesService({
      steamData,
      maxResults: 10,
    }),
    getGame: createSteamGetGameService({ steamData }),
  };
  const server = new McpServer({ name: "steam-mcp", version: "0.1.0" });
  registerSteamTools(
    server,
    createLocalToolBindings(
      services,
      options.localDefault,
      options.policy.executionDeadlineMs,
    ),
    createSteamToolContracts({
      defaultPageSize: options.policy.defaultPageSize,
      maxPageSize: options.policy.maxPageSize,
      maxSearchResults: 10,
    }),
  );
  return server;
}
