import type { SteamDataPort } from "../ports/steam-data.js";
import { failure, success } from "../../domain/result.js";
import type {
  PlayerBanSummary,
  PlayerSummary,
} from "../../domain/steam-data.js";
import type {
  ResolveSteamIdentityInput,
  SteamIdentityResolver,
} from "./steam-identity-resolver.js";
import { SteamIdentityResolutionError } from "./steam-identity-resolver.js";

interface SteamGetPlayerDependencies {
  readonly identityResolver: SteamIdentityResolver;
  readonly steamData: Pick<SteamDataPort, "getPlayers" | "getPlayerBans">;
}

export interface SteamPlayerDetails {
  readonly steamId: PlayerSummary["steamId"];
  readonly profile: PlayerSummary;
  readonly bans: PlayerBanSummary;
}

export function createSteamGetPlayerService(
  dependencies: SteamGetPlayerDependencies,
) {
  return {
    async execute(input: ResolveSteamIdentityInput, signal: AbortSignal) {
      let identity;
      try {
        identity = await dependencies.identityResolver.resolve(input, signal);
      } catch (error) {
        if (error instanceof SteamIdentityResolutionError) {
          return failure(error.code, error.message, error.retryable);
        }
        throw error;
      }
      const profiles = await dependencies.steamData.getPlayers(
        [identity.steamId],
        signal,
      );
      const profile = profiles.find(
        (candidate) => candidate.steamId === identity.steamId,
      );
      if (profile === undefined) {
        return failure(
          "NOT_FOUND",
          "The requested Steam player was not found",
          false,
        );
      }
      const bans = await dependencies.steamData.getPlayerBans(
        [identity.steamId],
        signal,
      );
      const banSummary = bans.find(
        (candidate) => candidate.steamId === identity.steamId,
      );
      if (banSummary === undefined) {
        return failure(
          "UPSTREAM_UNAVAILABLE",
          "Steam did not return the requested player's ban summary",
          false,
        );
      }
      return success<SteamPlayerDetails>(
        { steamId: identity.steamId, profile, bans: banSummary },
        ["supported"],
      );
    },
  };
}
