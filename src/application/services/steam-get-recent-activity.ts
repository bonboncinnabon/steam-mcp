import type { SteamDataPort } from "../ports/steam-data.js";
import { failure, success } from "../../domain/result.js";
import type { OwnedGame, PlayerSummary } from "../../domain/steam-data.js";
import type { AppId } from "../../domain/app-id.js";
import type { SteamId64 } from "../../domain/steam-id.js";
import type {
  ResolveSteamIdentityInput,
  SteamIdentityResolver,
} from "./steam-identity-resolver.js";
import { SteamIdentityResolutionError } from "./steam-identity-resolver.js";

interface SteamGetRecentActivityDependencies {
  readonly identityResolver: SteamIdentityResolver;
  readonly steamData: Pick<SteamDataPort, "getOwnedGames" | "getPlayers">;
  readonly maxItems: number;
}

export interface SteamGetRecentActivityInput extends ResolveSteamIdentityInput {
  readonly limit: number;
}

type CurrentActivity =
  | {
      readonly status: "playing";
      readonly appId: AppId;
      readonly onlineState?: PlayerSummary["onlineState"];
    }
  | {
      readonly status: "not_playing";
      readonly onlineState?: PlayerSummary["onlineState"];
    }
  | { readonly status: "unavailable" };

export interface SteamRecentActivity {
  readonly steamId: SteamId64;
  readonly recentGames: readonly OwnedGame[];
  readonly currentActivity: CurrentActivity;
}

export function createSteamGetRecentActivityService(
  dependencies: SteamGetRecentActivityDependencies,
) {
  if (!Number.isInteger(dependencies.maxItems) || dependencies.maxItems < 1) {
    throw new RangeError("Recent activity maximum must be positive");
  }

  return {
    async execute(input: SteamGetRecentActivityInput, signal: AbortSignal) {
      if (
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > dependencies.maxItems
      ) {
        return failure(
          "INVALID_INPUT",
          "Recent activity limit is outside the configured bounds",
          false,
        );
      }
      const identityInput: ResolveSteamIdentityInput = {
        ...(input.explicitUser === undefined
          ? {}
          : { explicitUser: input.explicitUser }),
        ...(input.configuredDefault === undefined
          ? {}
          : { configuredDefault: input.configuredDefault }),
      };
      let identity;
      try {
        identity = await dependencies.identityResolver.resolve(
          identityInput,
          signal,
        );
      } catch (error) {
        if (error instanceof SteamIdentityResolutionError) {
          return failure(error.code, error.message, error.retryable);
        }
        throw error;
      }
      const [recentResult, profileResult] = await Promise.allSettled([
        dependencies.steamData.getOwnedGames(identity.steamId, signal),
        dependencies.steamData.getPlayers([identity.steamId], signal),
      ]);
      if (recentResult.status === "rejected") {
        throw recentResult.reason;
      }
      if (recentResult.value.visibility === "private") {
        return failure(
          "PROFILE_PRIVATE",
          "This Steam profile does not expose recent game activity publicly",
          false,
        );
      }
      const profile =
        profileResult.status === "fulfilled"
          ? profileResult.value.find(
              (candidate) => candidate.steamId === identity.steamId,
            )
          : undefined;
      const currentActivity = normalizeCurrentActivity(profile);
      const profileUnavailable = profile === undefined;
      return success<SteamRecentActivity>(
        {
          steamId: identity.steamId,
          recentGames: recentResult.value.items
            .filter(hasLastPlayedAt)
            .toSorted((left, right) =>
              right.lastPlayedAt.localeCompare(left.lastPlayedAt),
            )
            .slice(0, input.limit),
          currentActivity,
        },
        ["supported"],
        {
          partial: profileUnavailable,
          warnings: profileUnavailable
            ? ["Current Steam activity is unavailable."]
            : [],
        },
      );
    },
  };
}

function hasLastPlayedAt(
  game: OwnedGame,
): game is OwnedGame & { readonly lastPlayedAt: string } {
  return game.lastPlayedAt !== undefined;
}

function normalizeCurrentActivity(
  profile: PlayerSummary | undefined,
): CurrentActivity {
  if (profile === undefined) {
    return { status: "unavailable" };
  }
  if (profile.currentAppId === undefined) {
    return {
      status: "not_playing",
      ...(profile.onlineState === undefined
        ? {}
        : { onlineState: profile.onlineState }),
    };
  }
  return {
    status: "playing",
    appId: profile.currentAppId,
    ...(profile.onlineState === undefined
      ? {}
      : { onlineState: profile.onlineState }),
  };
}
