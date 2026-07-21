import { z } from "zod";

import {
  decodeOpaqueCursor,
  encodeOpaqueCursor,
} from "../pagination/opaque-cursor.js";
import type { SteamDataPort } from "../ports/steam-data.js";
import type { PaginationCursor } from "../../domain/pagination-cursor.js";
import { failure, success } from "../../domain/result.js";
import type {
  EnrichedFriendRelationship,
  FriendRelationship,
} from "../../domain/steam-data.js";
import type { SteamId64 } from "../../domain/steam-id.js";
import type {
  ResolveSteamIdentityInput,
  SteamIdentityResolver,
} from "./steam-identity-resolver.js";
import { SteamIdentityResolutionError } from "./steam-identity-resolver.js";
import { enrichFriendProfiles } from "./friend-profile-enrichment.js";

const friendCursorSchema = z.object({
  version: z.literal(1),
  steamId: z.string(),
  includePresence: z.boolean(),
  offset: z.number().int().nonnegative(),
});

type FriendCursorPayload = z.infer<typeof friendCursorSchema>;

interface SteamGetFriendsDependencies {
  readonly identityResolver: SteamIdentityResolver;
  readonly steamData: Pick<SteamDataPort, "getFriends" | "getPlayers">;
  readonly maxPageSize: number;
  readonly maxPresenceProfiles: number;
}

export interface SteamGetFriendsInput extends ResolveSteamIdentityInput {
  readonly limit: number;
  readonly cursor?: string;
  readonly includePresence?: boolean;
}

export interface SteamFriendPage {
  readonly steamId: SteamId64;
  readonly friends: readonly (
    FriendRelationship | EnrichedFriendRelationship
  )[];
  readonly totalCount: number;
  readonly nextCursor?: PaginationCursor;
}

export function createSteamGetFriendsService(
  dependencies: SteamGetFriendsDependencies,
) {
  if (
    !Number.isInteger(dependencies.maxPageSize) ||
    dependencies.maxPageSize < 1
  ) {
    throw new RangeError("Friend maximum page size must be positive");
  }
  if (
    !Number.isInteger(dependencies.maxPresenceProfiles) ||
    dependencies.maxPresenceProfiles < 1 ||
    dependencies.maxPresenceProfiles > 100
  ) {
    throw new RangeError("Friend presence limit must be between 1 and 100");
  }

  return {
    async execute(input: SteamGetFriendsInput, signal: AbortSignal) {
      if (
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > dependencies.maxPageSize
      ) {
        return failure(
          "INVALID_INPUT",
          "Friend limit is outside the configured bounds",
          false,
        );
      }
      const includePresence = input.includePresence ?? false;
      let cursor: FriendCursorPayload | undefined;
      try {
        cursor =
          input.cursor === undefined
            ? undefined
            : decodeOpaqueCursor(input.cursor, friendCursorSchema);
      } catch {
        return failure("INVALID_INPUT", "Invalid friend cursor", false);
      }
      let identity;
      try {
        identity = await dependencies.identityResolver.resolve(
          {
            ...(input.explicitUser === undefined
              ? {}
              : { explicitUser: input.explicitUser }),
            ...(input.localDefault === undefined
              ? {}
              : { localDefault: input.localDefault }),
          },
          signal,
        );
      } catch (error) {
        if (error instanceof SteamIdentityResolutionError) {
          return failure(error.code, error.message, error.retryable);
        }
        throw error;
      }
      if (
        cursor !== undefined &&
        (cursor.steamId !== identity.steamId ||
          cursor.includePresence !== includePresence)
      ) {
        return failure(
          "INVALID_INPUT",
          "Friend cursor does not match this request",
          false,
        );
      }
      const relationships = await dependencies.steamData.getFriends(
        identity.steamId,
        signal,
      );
      if (relationships.visibility === "private") {
        return failure(
          "PROFILE_PRIVATE",
          "This Steam profile does not expose its friend list publicly",
          false,
        );
      }
      const offset = cursor?.offset ?? 0;
      if (offset > relationships.items.length) {
        return failure("INVALID_INPUT", "Friend cursor is out of range", false);
      }
      const page = relationships.items.slice(offset, offset + input.limit);
      let friends: SteamFriendPage["friends"] = page;
      let warnings: readonly string[] = [];
      if (includePresence) {
        try {
          friends = await enrichFriendProfiles(
            page,
            dependencies.maxPresenceProfiles,
            (steamIds, batchSignal) =>
              dependencies.steamData.getPlayers(steamIds, batchSignal),
            signal,
          );
        } catch (error) {
          if (signal.aborted) {
            throw error;
          }
          friends = unavailableEnrichment(
            page,
            dependencies.maxPresenceProfiles,
          );
          warnings = ["Friend presence is unavailable."];
        }
      }
      const nextOffset = offset + page.length;
      const nextCursor =
        nextOffset < relationships.items.length
          ? encodeOpaqueCursor({
              version: 1,
              steamId: identity.steamId,
              includePresence,
              offset: nextOffset,
            } satisfies FriendCursorPayload)
          : undefined;

      return success<SteamFriendPage>(
        {
          steamId: identity.steamId,
          friends,
          totalCount: relationships.items.length,
          ...(nextCursor === undefined ? {} : { nextCursor }),
        },
        ["supported"],
        { partial: warnings.length > 0, warnings },
      );
    },
  };
}

function unavailableEnrichment(
  friends: readonly FriendRelationship[],
  maxProfiles: number,
): readonly EnrichedFriendRelationship[] {
  return friends.map((relationship, index) => ({
    relationship,
    enrichment:
      index < maxProfiles
        ? { status: "unavailable" }
        : { status: "fan_out_limited" },
  }));
}
