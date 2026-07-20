import type { SteamDataPort } from "../ports/steam-data.js";
import { failure, success } from "../../domain/result.js";
import type { GameSearchCandidate } from "../../domain/steam-data.js";

interface SteamSearchGamesDependencies {
  readonly steamData: Pick<SteamDataPort, "searchGames">;
  readonly maxResults: number;
}

export interface SteamSearchGamesInput {
  readonly query: string;
  readonly limit: number;
}

export interface SteamGameSearchResult {
  readonly query: string;
  readonly candidates: readonly GameSearchCandidate[];
}

export function createSteamSearchGamesService(
  dependencies: SteamSearchGamesDependencies,
) {
  if (
    !Number.isInteger(dependencies.maxResults) ||
    dependencies.maxResults < 1 ||
    dependencies.maxResults > 10
  ) {
    throw new RangeError("Game search maximum must be between 1 and 10");
  }

  return {
    async execute(input: SteamSearchGamesInput, signal: AbortSignal) {
      const query = input.query.trim();
      if (query.length === 0 || query.length > 100) {
        return failure(
          "INVALID_INPUT",
          "Game search query must contain 1 to 100 characters",
          false,
        );
      }
      if (
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > dependencies.maxResults
      ) {
        return failure(
          "INVALID_INPUT",
          "Game search limit is outside the configured bounds",
          false,
        );
      }

      const candidates = await dependencies.steamData.searchGames(
        query,
        signal,
      );
      return success<SteamGameSearchResult>(
        { query, candidates: candidates.slice(0, input.limit) },
        ["best_effort"],
      );
    },
  };
}
