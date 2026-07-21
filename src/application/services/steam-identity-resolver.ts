import type { SteamDataPort } from "../ports/steam-data.js";
import type { SteamId64 } from "../../domain/steam-id.js";
import type { ErrorCode } from "../../domain/result.js";
import { parseSteamUserReference } from "../../identity/steam-user-reference.js";

interface SteamIdentityResolverDependencies {
  readonly steamIdentities: Pick<SteamDataPort, "resolveVanityName">;
}

export interface ResolveSteamIdentityInput {
  readonly explicitUser?: string;
  readonly localDefault?: string;
}

export interface ResolvedSteamIdentity {
  readonly steamId: SteamId64;
  readonly source: "explicit" | "local_default";
}

export interface SteamIdentityResolver {
  resolve(
    input: ResolveSteamIdentityInput,
    signal: AbortSignal,
  ): Promise<ResolvedSteamIdentity>;
}

export class SteamIdentityResolutionError extends Error {
  readonly retryable = false;

  constructor(
    readonly code: Extract<ErrorCode, "IDENTITY_NOT_LINKED" | "NOT_FOUND">,
    message: string,
  ) {
    super(message);
  }
}

export function createSteamIdentityResolver(
  dependencies: SteamIdentityResolverDependencies,
): SteamIdentityResolver {
  return {
    async resolve(
      input: ResolveSteamIdentityInput,
      signal: AbortSignal,
    ): Promise<ResolvedSteamIdentity> {
      if (input.explicitUser !== undefined) {
        const reference = parseSteamUserReference(input.explicitUser);
        if (reference.kind === "steam_id") {
          return { steamId: reference.steamId, source: "explicit" };
        }
        const steamId = await dependencies.steamIdentities.resolveVanityName(
          reference.vanity,
          signal,
        );
        if (steamId !== undefined) {
          return { steamId, source: "explicit" };
        }
        throw new SteamIdentityResolutionError(
          "NOT_FOUND",
          "The requested Steam user was not found",
        );
      }
      if (input.localDefault !== undefined) {
        const reference = parseSteamUserReference(input.localDefault);
        if (reference.kind === "steam_id") {
          return {
            steamId: reference.steamId,
            source: "local_default",
          };
        }
        const steamId = await dependencies.steamIdentities.resolveVanityName(
          reference.vanity,
          signal,
        );
        if (steamId !== undefined) {
          return { steamId, source: "local_default" };
        }
        throw new SteamIdentityResolutionError(
          "NOT_FOUND",
          "The configured default Steam user was not found",
        );
      }
      throw new SteamIdentityResolutionError(
        "IDENTITY_NOT_LINKED",
        "Provide a Steam user, or configure STEAM_USER for local use",
      );
    },
  };
}
