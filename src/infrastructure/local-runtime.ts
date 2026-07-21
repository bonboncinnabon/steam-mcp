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
import { executeSteamRequest } from "../steam/http/steam-http-client.js";
import type { SteamHttpRequest } from "../steam/http/steam-request.js";
import { SteamUpstreamError } from "../steam/http/steam-retry-policy.js";
import { parseLocalConfig } from "./config.js";

type Environment = Readonly<Record<string, string | undefined>>;

interface LocalRuntimeOptions {
  readonly fetchImpl?: typeof fetch;
}

const LOCAL_STOREFRONT = Object.freeze({
  countryCode: "US",
  currency: parseCurrencyCode("USD"),
  language: "english",
});

export function createLocalMcpServer(
  environment: Environment,
  options: LocalRuntimeOptions = {},
): McpServer {
  const config = parseLocalConfig(environment);
  const execute = createLocalSteamExecutor(
    config.steamApiKey,
    config.policy,
    options,
  );
  const apiKey = config.steamApiKey ?? "";
  const vanity = createSteamVanityAdapter({ apiKey, execute });
  const player = createSteamPlayerAdapter({ apiKey, execute });
  const library = createSteamLibraryAdapter({ apiKey, execute });
  const achievements = createSteamAchievementAdapter({ apiKey, execute });
  const friends = createSteamFriendAdapter({ apiKey, execute });
  const wishlist = createSteamWishlistAdapter({
    execute,
    enabled: true,
    ...LOCAL_STOREFRONT,
    maxPageSize: config.policy.maxPageSize,
  });
  const store = createSteamStoreAdapter({
    execute,
    searchEnabled: true,
    detailsEnabled: true,
    countryCode: LOCAL_STOREFRONT.countryCode,
    language: LOCAL_STOREFRONT.language,
  });
  const game = createSteamGameAdapter({
    execute,
    maxNewsItems: config.policy.maxPageSize,
  });
  const reviews = createSteamReviewAdapter({ execute, enabled: true });
  const deck = createSteamDeckAdapter({ execute, enabled: true });
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
    linkedIdentities: {
      /* v8 ignore next -- local MCP inputs never carry hosted subjects. */
      getLinkedSteamId: () => Promise.resolve(undefined),
    },
    steamIdentities: steamData,
  });
  const services = {
    getPlayer: createSteamGetPlayerService({ identityResolver, steamData }),
    getLibrary: createSteamGetLibraryService({
      identityResolver,
      steamData,
      maxPageSize: config.policy.maxPageSize,
    }),
    getRecentActivity: createSteamGetRecentActivityService({
      identityResolver,
      steamData,
      maxItems: config.policy.maxPageSize,
    }),
    getAchievements: createSteamGetAchievementsService({
      identityResolver,
      steamData,
      maxPageSize: config.policy.maxPageSize,
    }),
    getFriends: createSteamGetFriendsService({
      identityResolver,
      steamData,
      maxPageSize: config.policy.maxPageSize,
      maxPresenceProfiles: Math.min(config.policy.maxToolFanOut, 100),
    }),
    getWishlist: createSteamGetWishlistService({
      identityResolver,
      steamData,
      maxPageSize: config.policy.maxPageSize,
    }),
    searchGames: createSteamSearchGamesService({
      steamData,
      maxResults: 10,
    }),
    getGame: createSteamGetGameService({ steamData }),
  };
  const server = new McpServer({ name: "steam-mcp", version: "0.0.0" });
  registerSteamTools(
    server,
    createLocalToolBindings(services, config.steamUser),
    createSteamToolContracts({
      defaultPageSize: config.policy.defaultPageSize,
      maxPageSize: config.policy.maxPageSize,
      maxSearchResults: 10,
    }),
  );
  return server;
}

function createLocalSteamExecutor(
  steamApiKey: string | undefined,
  policy: ReturnType<typeof parseLocalConfig>["policy"],
  options: LocalRuntimeOptions,
) {
  return (request: SteamHttpRequest, signal: AbortSignal) => {
    if (steamApiKey === undefined && requestRequiresApiKey(request)) {
      throw new SteamUpstreamError({
        code: "STEAM_AUTH_FAILED",
        retryable: false,
      });
    }
    return executeSteamRequest(request, {
      ...(options.fetchImpl === undefined
        ? {}
        : { fetchImpl: options.fetchImpl }),
      deadlineMs: policy.upstreamTimeoutMs,
      maxRetryAttempts: policy.maxRetryAttempts,
      maxResponseBytes: policy.maxOutputBytes,
      signal,
    });
  };
}

function requestRequiresApiKey(request: SteamHttpRequest): boolean {
  return new URL(request.url).searchParams.has("key");
}
