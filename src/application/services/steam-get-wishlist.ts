import { z } from "zod";

import {
  decodeOpaqueCursor,
  encodeOpaqueCursor,
} from "../pagination/opaque-cursor.js";
import type { SteamDataPort } from "../ports/steam-data.js";
import type { PaginationCursor } from "../../domain/pagination-cursor.js";
import { failure, success } from "../../domain/result.js";
import type { WishlistItem } from "../../domain/steam-data.js";
import type { SteamId64 } from "../../domain/steam-id.js";
import type {
  ResolveSteamIdentityInput,
  SteamIdentityResolver,
} from "./steam-identity-resolver.js";
import { SteamIdentityResolutionError } from "./steam-identity-resolver.js";

const wishlistCursorSchema = z.object({
  version: z.literal(1),
  steamId: z.string(),
  offset: z.number().int().nonnegative(),
});

type WishlistCursorPayload = z.infer<typeof wishlistCursorSchema>;

interface SteamGetWishlistDependencies {
  readonly identityResolver: SteamIdentityResolver;
  readonly steamData: Pick<SteamDataPort, "getWishlist">;
  readonly maxPageSize: number;
}

export interface SteamGetWishlistInput extends ResolveSteamIdentityInput {
  readonly limit: number;
  readonly cursor?: string;
}

export interface SteamWishlistPage {
  readonly steamId: SteamId64;
  readonly items: readonly WishlistItem[];
  readonly totalCount: number;
  readonly nextCursor?: PaginationCursor;
}

export function createSteamGetWishlistService(
  dependencies: SteamGetWishlistDependencies,
) {
  if (
    !Number.isInteger(dependencies.maxPageSize) ||
    dependencies.maxPageSize < 1
  ) {
    throw new RangeError("Wishlist maximum page size must be positive");
  }

  return {
    async execute(input: SteamGetWishlistInput, signal: AbortSignal) {
      if (
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > dependencies.maxPageSize
      ) {
        return failure(
          "INVALID_INPUT",
          "Wishlist limit is outside the configured bounds",
          false,
        );
      }
      let cursor: WishlistCursorPayload | undefined;
      try {
        cursor =
          input.cursor === undefined
            ? undefined
            : decodeOpaqueCursor(input.cursor, wishlistCursorSchema);
      } catch {
        return failure("INVALID_INPUT", "Invalid wishlist cursor", false);
      }
      let identity;
      try {
        identity = await dependencies.identityResolver.resolve(
          {
            ...(input.explicitUser === undefined
              ? {}
              : { explicitUser: input.explicitUser }),
            ...(input.subject === undefined ? {} : { subject: input.subject }),
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
      if (cursor !== undefined && cursor.steamId !== identity.steamId) {
        return failure(
          "INVALID_INPUT",
          "Wishlist cursor does not match this request",
          false,
        );
      }
      const offset = cursor?.offset ?? 0;
      const wishlist = await dependencies.steamData.getWishlist(
        identity.steamId,
        { startIndex: offset, pageSize: input.limit },
        signal,
      );
      if (wishlist.visibility === "private") {
        return failure(
          "PROFILE_PRIVATE",
          "This Steam profile does not expose a public wishlist",
          false,
        );
      }
      if (offset > wishlist.totalCount) {
        return failure(
          "INVALID_INPUT",
          "Wishlist cursor is out of range",
          false,
        );
      }
      if (wishlist.items.length === 0 && offset < wishlist.totalCount) {
        return failure(
          "BEST_EFFORT_SOURCE_CHANGED",
          "The Steam wishlist source returned inconsistent pagination",
          false,
        );
      }
      const nextOffset = offset + wishlist.items.length;
      const nextCursor =
        nextOffset < wishlist.totalCount
          ? encodeOpaqueCursor({
              version: 1,
              steamId: identity.steamId,
              offset: nextOffset,
            } satisfies WishlistCursorPayload)
          : undefined;

      return success<SteamWishlistPage>(
        {
          steamId: identity.steamId,
          items: wishlist.items,
          totalCount: wishlist.totalCount,
          ...(nextCursor === undefined ? {} : { nextCursor }),
        },
        ["best_effort"],
      );
    },
  };
}
