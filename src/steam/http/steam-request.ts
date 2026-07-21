import { URL } from "node:url";

import type { AppId } from "../../domain/app-id.js";
import { assertSteamStorefrontPolicy } from "../storefront-policy.js";

export const STEAM_HOST_ALLOWLIST = [
  "api.steampowered.com",
  "store.steampowered.com",
  "steamcommunity.com",
] as const;

type SteamHost = (typeof STEAM_HOST_ALLOWLIST)[number];

interface EndpointDefinition {
  readonly host: SteamHost;
  readonly path: `/${string}`;
  readonly acceptedErrorStatuses?: readonly number[];
}

const STEAM_ENDPOINTS = {
  storeDetails: {
    host: "store.steampowered.com",
    path: "/api/appdetails",
  },
  resolveVanityUrl: {
    host: "api.steampowered.com",
    path: "/ISteamUser/ResolveVanityURL/v0001/",
  },
  getPlayerSummaries: {
    host: "api.steampowered.com",
    path: "/ISteamUser/GetPlayerSummaries/v0002/",
  },
  getPlayerBans: {
    host: "api.steampowered.com",
    path: "/ISteamUser/GetPlayerBans/v1/",
  },
  getOwnedGames: {
    host: "api.steampowered.com",
    path: "/IPlayerService/GetOwnedGames/v0001/",
  },
  getRecentlyPlayedGames: {
    host: "api.steampowered.com",
    path: "/IPlayerService/GetRecentlyPlayedGames/v0001/",
  },
  getPlayerAchievements: {
    host: "api.steampowered.com",
    path: "/ISteamUserStats/GetPlayerAchievements/v1/",
  },
  getAchievementSchema: {
    host: "api.steampowered.com",
    path: "/ISteamUserStats/GetSchemaForGame/v2/",
  },
  getGlobalAchievementPercentages: {
    host: "api.steampowered.com",
    path: "/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/",
  },
  getFriendList: {
    host: "api.steampowered.com",
    path: "/ISteamUser/GetFriendList/v1/",
    acceptedErrorStatuses: [401],
  },
  getCurrentPlayers: {
    host: "api.steampowered.com",
    path: "/ISteamUserStats/GetNumberOfCurrentPlayers/v1/",
  },
  getGameNews: {
    host: "api.steampowered.com",
    path: "/ISteamNews/GetNewsForApp/v2/",
  },
  getWishlist: {
    host: "api.steampowered.com",
    path: "/IWishlistService/GetWishlistSortedFiltered/v1/",
  },
  storeSearch: {
    host: "store.steampowered.com",
    path: "/api/storesearch/",
  },
  storeGameDetails: {
    host: "store.steampowered.com",
    path: "/api/appdetails",
  },
  deckCompatibility: {
    host: "store.steampowered.com",
    path: "/saleaction/ajaxgetdeckappcompatibilityreport",
  },
  getStoreTags: {
    host: "api.steampowered.com",
    path: "/IStoreBrowseService/GetItems/v1/",
  },
} as const satisfies Readonly<Record<string, EndpointDefinition>>;

type SteamEndpoint = keyof typeof STEAM_ENDPOINTS;

interface SteamEndpointQueries {
  readonly storeDetails: Readonly<{ appids: string }>;
  readonly resolveVanityUrl: Readonly<{ key: string; vanityurl: string }>;
  readonly getPlayerSummaries: Readonly<{ key: string; steamids: string }>;
  readonly getPlayerBans: Readonly<{ key: string; steamids: string }>;
  readonly getOwnedGames: Readonly<{
    key: string;
    steamid: string;
    include_appinfo: "1";
    include_played_free_games: "1";
    format: "json";
  }>;
  readonly getRecentlyPlayedGames: Readonly<{
    key: string;
    steamid: string;
    count: string;
    format: "json";
  }>;
  readonly getPlayerAchievements: Readonly<{
    key: string;
    steamid: string;
    appid: string;
    l: "english";
  }>;
  readonly getAchievementSchema: Readonly<{
    key: string;
    appid: string;
    l: "english";
  }>;
  readonly getGlobalAchievementPercentages: Readonly<{ gameid: string }>;
  readonly getFriendList: Readonly<{
    key: string;
    steamid: string;
    relationship: "friend";
  }>;
  readonly getCurrentPlayers: Readonly<{ appid: string }>;
  readonly getGameNews: Readonly<{
    appid: string;
    count: string;
    maxlength: "1";
  }>;
  readonly getWishlist: Readonly<{ input_json: string }>;
  readonly storeSearch: Readonly<{
    term: string;
    l: string;
    cc: string;
  }>;
  readonly storeGameDetails: Readonly<{
    appids: string;
    cc: string;
    l: string;
    filters: string;
  }>;
  readonly deckCompatibility: Readonly<{ nAppID: string }>;
  readonly getStoreTags: Readonly<{ input_json: string }>;
}

export interface SteamHttpRequest {
  readonly operation: SteamOperation;
  readonly url: string;
  readonly method: "GET";
  readonly headers: Readonly<{ accept: "application/json" }>;
  readonly redirect: "manual";
  readonly acceptedErrorStatuses?: readonly number[];
}

export type SteamOperation = SteamEndpoint | "appReviews" | "tagVocabulary";

export function buildSteamRequest<E extends SteamEndpoint>(
  endpoint: E,
  query: SteamEndpointQueries[E],
): SteamHttpRequest {
  const definition = (
    STEAM_ENDPOINTS as Partial<Record<string, EndpointDefinition>>
  )[endpoint];

  if (definition === undefined) {
    throw new TypeError("Unknown Steam endpoint");
  }

  const url = new URL(definition.path, `https://${definition.host}`);
  for (const [name, value] of Object.entries(query)) {
    url.searchParams.set(name, value);
  }

  return {
    operation: endpoint,
    url: url.href,
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "manual",
    ...(definition.acceptedErrorStatuses === undefined
      ? {}
      : { acceptedErrorStatuses: definition.acceptedErrorStatuses }),
  };
}

export function buildSteamAppReviewsRequest(appId: AppId): SteamHttpRequest {
  const url = new URL(
    `/appreviews/${String(appId)}`,
    "https://store.steampowered.com",
  );
  url.searchParams.set("json", "1");
  url.searchParams.set("language", "all");
  url.searchParams.set("purchase_type", "all");
  url.searchParams.set("num_per_page", "0");

  return {
    operation: "appReviews",
    url: url.href,
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "manual",
  };
}

export function buildSteamTagVocabularyRequest(
  language: string,
): SteamHttpRequest {
  assertSteamStorefrontPolicy("US", language);
  const url = new URL(
    `/tagdata/populartags/${language}`,
    "https://store.steampowered.com",
  );
  return {
    operation: "tagVocabulary",
    url: url.href,
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "manual",
  };
}
