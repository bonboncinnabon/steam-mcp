import type { AppId } from "../../domain/app-id.js";
import type {
  DeckCompatibility,
  FriendRelationship,
  GameNewsItem,
  GameReviewSummary,
  GameSearchCandidate,
  OwnedGame,
  PlayerDataCollection,
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
  ): Promise<readonly PlayerAchievement[]>;
  getFriends(
    steamId: SteamId64,
    signal: AbortSignal,
  ): Promise<readonly FriendRelationship[]>;
  getWishlist(
    steamId: SteamId64,
    signal: AbortSignal,
  ): Promise<readonly WishlistItem[]>;
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
