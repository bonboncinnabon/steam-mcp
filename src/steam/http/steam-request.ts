import { URL } from "node:url";

export const STEAM_HOST_ALLOWLIST = [
  "api.steampowered.com",
  "store.steampowered.com",
  "steamcommunity.com",
] as const;

type SteamHost = (typeof STEAM_HOST_ALLOWLIST)[number];

interface EndpointDefinition {
  readonly host: SteamHost;
  readonly path: `/${string}`;
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
}

export interface SteamHttpRequest {
  readonly url: string;
  readonly method: "GET";
  readonly headers: Readonly<{ accept: "application/json" }>;
  readonly redirect: "manual";
}

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
    url: url.href,
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "manual",
  };
}
