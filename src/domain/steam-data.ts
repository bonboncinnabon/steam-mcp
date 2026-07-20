import type { AppId } from "./app-id.js";
import type { CurrencyCode } from "./currency.js";
import type { IsoTimestamp } from "./iso-timestamp.js";
import type { SteamId64 } from "./steam-id.js";

export type DataVisibility = "public" | "private";

export type PlayerDataCollection<T> =
  | { readonly visibility: "public"; readonly items: readonly T[] }
  | { readonly visibility: "private"; readonly items: readonly [] };

export type PlayerDataPage<T> =
  | {
      readonly visibility: "public";
      readonly items: readonly T[];
      readonly totalCount: number;
    }
  | { readonly visibility: "private"; readonly items: readonly [] };

export interface PlayerSummary {
  readonly steamId: SteamId64;
  readonly displayName: string;
  readonly profileUrl: string;
  readonly avatarUrl?: string;
  readonly visibility: DataVisibility;
  readonly onlineState?: "offline" | "online" | "busy" | "away";
  readonly currentAppId?: AppId;
  readonly lastLogoffAt?: IsoTimestamp;
}

export interface PlayerBanSummary {
  readonly steamId: SteamId64;
  readonly communityBanned: boolean;
  readonly vacBanCount: number;
  readonly gameBanCount: number;
  readonly economyBan: "none" | "probation" | "banned";
}

export interface OwnedGame {
  readonly appId: AppId;
  readonly name?: string;
  readonly playtimeMinutes: number;
  readonly recentPlaytimeMinutes?: number;
  readonly lastPlayedAt?: IsoTimestamp;
}

export interface PlayerAchievement {
  readonly apiName: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly achieved: boolean;
  readonly unlockedAt?: IsoTimestamp;
  readonly globalPercent?: number;
}

export interface GameAchievementDefinition {
  readonly apiName: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly hidden: boolean;
  readonly iconUrl?: string;
  readonly lockedIconUrl?: string;
}

export interface GlobalAchievementPercentage {
  readonly apiName: string;
  readonly globalPercent: number;
}

export interface FriendRelationship {
  readonly steamId: SteamId64;
  readonly friendsSince?: IsoTimestamp;
}

export type FriendProfileEnrichment =
  | { readonly status: "available"; readonly profile: PlayerSummary }
  | { readonly status: "unavailable" }
  | { readonly status: "fan_out_limited" };

export interface EnrichedFriendRelationship {
  readonly relationship: FriendRelationship;
  readonly enrichment: FriendProfileEnrichment;
}

export interface Price {
  readonly minorUnits: number;
  readonly currency?: CurrencyCode;
}

export interface WishlistItem {
  readonly appId: AppId;
  readonly name?: string;
  readonly available: boolean;
  readonly price?: Price;
  readonly discountPercent?: number;
}

export interface GameSearchCandidate {
  readonly appId: AppId;
  readonly name: string;
  readonly releaseDate?: string;
  readonly imageUrl?: string;
}

export interface StoreGameDetails {
  readonly appId: AppId;
  readonly name: string;
  readonly shortDescription?: string;
  readonly developers: readonly string[];
  readonly publishers: readonly string[];
  readonly genres: readonly string[];
  readonly categories: readonly string[];
  readonly price?: Price;
  readonly releaseDate?: string;
}

export interface GameReviewSummary {
  readonly totalPositive: number;
  readonly totalNegative: number;
  readonly scoreDescription?: string;
}

export interface GameNewsItem {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly publishedAt: IsoTimestamp;
}

export interface DeckCompatibility {
  readonly category: "unknown" | "unsupported" | "playable" | "verified";
  readonly summary?: string;
}
