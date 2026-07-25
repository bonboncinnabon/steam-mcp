import type { AppId } from "../../domain/app-id.js";
import type {
  DeckCompatibility,
  FriendRelationship,
  GameNewsItem,
  GameAchievementDefinition,
  GameReviewSummary,
  GameSearchCandidate,
  GlobalAchievementPercentage,
  OwnedGame,
  PlayerDataCollection,
  PlayerDataPage,
  PlayerAchievement,
  PlayerBanSummary,
  PlayerSummary,
  StoreGameDetails,
  WishlistItem,
} from "../../domain/steam-data.js";
import type { SteamId64 } from "../../domain/steam-id.js";

export interface SteamDataPort {
  resolveVanityName(
    vanityName: string,
    signal: AbortSignal,
  ): Promise<SteamId64 | undefined>;
  getPlayers(
    steamIds: readonly SteamId64[],
    signal: AbortSignal,
  ): Promise<readonly PlayerSummary[]>;
  getPlayerBans(
    steamIds: readonly SteamId64[],
    signal: AbortSignal,
  ): Promise<readonly PlayerBanSummary[]>;
  getOwnedGames(
    steamId: SteamId64,
    signal: AbortSignal,
  ): Promise<PlayerDataCollection<OwnedGame>>;
  getRecentGames(
    steamId: SteamId64,
    signal: AbortSignal,
  ): Promise<PlayerDataCollection<OwnedGame>>;
  getPlayerAchievements(
    steamId: SteamId64,
    appId: AppId,
    signal: AbortSignal,
  ): Promise<PlayerDataCollection<PlayerAchievement>>;
  getGameAchievementSchema(
    appId: AppId,
    signal: AbortSignal,
  ): Promise<readonly GameAchievementDefinition[]>;
  getGlobalAchievementPercentages(
    appId: AppId,
    signal: AbortSignal,
  ): Promise<readonly GlobalAchievementPercentage[]>;
  getFriends(
    steamId: SteamId64,
    signal: AbortSignal,
  ): Promise<PlayerDataCollection<FriendRelationship>>;
  getWishlist(
    steamId: SteamId64,
    page: WishlistPageRequest,
    signal: AbortSignal,
  ): Promise<PlayerDataPage<WishlistItem>>;
  searchGames(
    query: string,
    signal: AbortSignal,
  ): Promise<readonly GameSearchCandidate[]>;
  getStoreGame(
    appId: AppId,
    signal: AbortSignal,
  ): Promise<StoreGameDetails | undefined>;
  getGameReviews(
    appId: AppId,
    signal: AbortSignal,
  ): Promise<GameReviewSummary | undefined>;
  getCurrentPlayers(appId: AppId, signal: AbortSignal): Promise<number>;
  getDeckCompatibility(
    appId: AppId,
    signal: AbortSignal,
  ): Promise<DeckCompatibility | undefined>;
  getGameNews(
    appId: AppId,
    signal: AbortSignal,
  ): Promise<readonly GameNewsItem[]>;
}

export interface WishlistPageRequest {
  readonly startIndex: number;
  readonly pageSize: number;
}
