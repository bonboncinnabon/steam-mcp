import { z } from "zod";

import type { SteamDataPort } from "../ports/steam-data.js";
import {
  parsePaginationCursor,
  type PaginationCursor,
} from "../../domain/pagination-cursor.js";
import { failure, success } from "../../domain/result.js";
import type { OwnedGame } from "../../domain/steam-data.js";
import { parseSteamId64, type SteamId64 } from "../../domain/steam-id.js";
import type {
  ResolveSteamIdentityInput,
  SteamIdentityResolver,
} from "./steam-identity-resolver.js";
import { SteamIdentityResolutionError } from "./steam-identity-resolver.js";

const libraryCursorSchema = z.object({
  version: z.literal(1),
  steamId: z.string(),
  offset: z.number().int().nonnegative(),
  query: z.string(),
  played: z.enum(["all", "played", "unplayed"]),
  sortBy: z.enum(["name", "playtime", "recent"]),
  sortDirection: z.enum(["asc", "desc"]),
});

type LibraryCursorPayload = z.infer<typeof libraryCursorSchema>;

interface SteamGetLibraryDependencies {
  readonly identityResolver: SteamIdentityResolver;
  readonly steamData: Pick<SteamDataPort, "getOwnedGames">;
  readonly maxPageSize: number;
}

export interface SteamGetLibraryInput extends ResolveSteamIdentityInput {
  readonly limit: number;
  readonly cursor?: string;
  readonly query?: string;
  readonly played?: "all" | "played" | "unplayed";
  readonly sortBy?: "name" | "playtime" | "recent";
  readonly sortDirection?: "asc" | "desc";
}

export interface SteamLibraryPage {
  readonly steamId: SteamId64;
  readonly games: readonly OwnedGame[];
  readonly totalCount: number;
  readonly nextCursor?: PaginationCursor;
}

export function createSteamGetLibraryService(
  dependencies: SteamGetLibraryDependencies,
) {
  if (
    !Number.isInteger(dependencies.maxPageSize) ||
    dependencies.maxPageSize < 1
  ) {
    throw new RangeError("Library maximum page size must be positive");
  }

  return {
    async execute(input: SteamGetLibraryInput, signal: AbortSignal) {
      if (
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > dependencies.maxPageSize
      ) {
        return failure(
          "INVALID_INPUT",
          "Library limit is outside the configured bounds",
          false,
        );
      }
      const query = input.query?.trim().toLowerCase() ?? "";
      if (query.length > 100) {
        return failure("INVALID_INPUT", "Library query is too long", false);
      }
      const played = input.played ?? "all";
      const sortBy = input.sortBy ?? "name";
      const sortDirection = input.sortDirection ?? "asc";
      let cursor: LibraryCursorPayload | undefined;
      try {
        cursor =
          input.cursor === undefined ? undefined : decodeCursor(input.cursor);
      } catch {
        return failure("INVALID_INPUT", "Invalid library cursor", false);
      }
      const identityInput: ResolveSteamIdentityInput = {
        ...(input.explicitUser === undefined
          ? {}
          : { explicitUser: input.explicitUser }),
        ...(input.subject === undefined ? {} : { subject: input.subject }),
        ...(input.localDefault === undefined
          ? {}
          : { localDefault: input.localDefault }),
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
      const expectedCursorContext = {
        steamId: identity.steamId,
        query,
        played,
        sortBy,
        sortDirection,
      };
      if (
        cursor !== undefined &&
        !matchesCursorContext(cursor, expectedCursorContext)
      ) {
        return failure(
          "INVALID_INPUT",
          "Library cursor does not match this request",
          false,
        );
      }
      const library = await dependencies.steamData.getOwnedGames(
        identity.steamId,
        signal,
      );
      if (library.visibility === "private") {
        return failure(
          "PROFILE_PRIVATE",
          "This Steam profile does not expose its game library publicly",
          false,
        );
      }
      const games = sortGames(
        library.items.filter(
          (game) =>
            matchesQuery(game, query) && matchesPlayedFilter(game, played),
        ),
        sortBy,
        sortDirection,
      );
      const offset = cursor?.offset ?? 0;
      if (offset > games.length) {
        return failure(
          "INVALID_INPUT",
          "Library cursor is out of range",
          false,
        );
      }
      const page = games.slice(offset, offset + input.limit);
      const nextOffset = offset + page.length;
      const nextCursor =
        nextOffset < games.length
          ? encodeCursor({
              version: 1,
              ...expectedCursorContext,
              offset: nextOffset,
            })
          : undefined;
      return success<SteamLibraryPage>(
        {
          steamId: identity.steamId,
          games: page,
          totalCount: games.length,
          ...(nextCursor === undefined ? {} : { nextCursor }),
        },
        ["supported"],
      );
    },
  };
}

function matchesQuery(game: OwnedGame, query: string): boolean {
  return query === "" || game.name?.toLowerCase().includes(query) === true;
}

function matchesPlayedFilter(
  game: OwnedGame,
  played: "all" | "played" | "unplayed",
): boolean {
  return (
    played === "all" ||
    (played === "played" && game.playtimeMinutes > 0) ||
    (played === "unplayed" && game.playtimeMinutes === 0)
  );
}

function sortGames(
  games: readonly OwnedGame[],
  sortBy: "name" | "playtime" | "recent",
  direction: "asc" | "desc",
): readonly OwnedGame[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...games].sort((left, right) => {
    const primary = comparePrimary(left, right, sortBy) * multiplier;
    return primary === 0 ? left.appId - right.appId : primary;
  });
}

function comparePrimary(
  left: OwnedGame,
  right: OwnedGame,
  sortBy: "name" | "playtime" | "recent",
): number {
  if (sortBy === "playtime") {
    return left.playtimeMinutes - right.playtimeMinutes;
  }
  const leftValue =
    sortBy === "recent" ? (left.lastPlayedAt ?? "") : (left.name ?? "");
  const rightValue =
    sortBy === "recent" ? (right.lastPlayedAt ?? "") : (right.name ?? "");
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function encodeCursor(payload: LibraryCursorPayload): PaginationCursor {
  return parsePaginationCursor(
    Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"),
  );
}

function decodeCursor(cursor: string): LibraryCursorPayload {
  const parsedCursor = parsePaginationCursor(cursor);
  try {
    const bytes = Buffer.from(parsedCursor, "base64url");
    if (bytes.toString("base64url") !== parsedCursor) {
      throw new TypeError("Invalid library cursor");
    }
    return libraryCursorSchema.parse(JSON.parse(bytes.toString("utf8")));
  } catch {
    throw new TypeError("Invalid library cursor");
  }
}

function matchesCursorContext(
  cursor: LibraryCursorPayload,
  expected: Omit<LibraryCursorPayload, "version" | "offset">,
): boolean {
  return (
    parseSteamId64(cursor.steamId) === expected.steamId &&
    cursor.query === expected.query &&
    cursor.played === expected.played &&
    cursor.sortBy === expected.sortBy &&
    cursor.sortDirection === expected.sortDirection
  );
}
