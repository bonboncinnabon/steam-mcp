import type { ErrorCode, SourceTier } from "../../domain/result.js";

export type SteamToolName =
  | "steam_get_player"
  | "steam_get_library"
  | "steam_get_recent_activity"
  | "steam_get_achievements"
  | "steam_get_friends"
  | "steam_get_wishlist"
  | "steam_search_games"
  | "steam_get_game";

export type BestEffortAdapterId =
  | "wishlist"
  | "store_search"
  | "store_details"
  | "deck_compatibility"
  | "store_tags"
  | "aggregate_reviews";

export type OperationalEvent =
  | {
      readonly name: "authorization_rejected";
      readonly reason:
        | "missing_token"
        | "invalid_token"
        | "insufficient_scope"
        | "dependency_unavailable";
    }
  | {
      readonly name: "quota_rejected";
      readonly reason: "user_exhausted" | "global_reserve" | "unavailable";
    }
  | {
      readonly name: "shutdown";
      readonly phase: "started" | "drained" | "deadline_exceeded" | "completed";
    }
  | {
      readonly name: "dependency_failure";
      readonly dependency: "authorization" | "quota" | "steam";
      readonly failureKind:
        "timeout" | "unavailable" | "malformed_response" | "internal";
    };

export interface ToolOutcomeMetric {
  readonly tool: SteamToolName;
  readonly durationMs: number;
  readonly errorCode?: ErrorCode;
  readonly sourceTiers: readonly SourceTier[];
  readonly statusClass?: "2xx" | "4xx" | "5xx";
}

export interface ObservabilityPort {
  recordToolOutcome(metric: ToolOutcomeMetric): void;
  recordBestEffortDrift(adapter: BestEffortAdapterId): void;
  recordEvent(event: OperationalEvent): void;
}
