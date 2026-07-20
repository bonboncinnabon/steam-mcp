import type { ClockPort } from "../ports/clock.js";
import type { SteamDataPort } from "../ports/steam-data.js";
import { failure, success } from "../../domain/result.js";
import type { OwnedGame, StoreGameDetails } from "../../domain/steam-data.js";
import type { SteamId64 } from "../../domain/steam-id.js";
import type {
  ResolveSteamIdentityInput,
  SteamIdentityResolver,
} from "./steam-identity-resolver.js";
import { SteamIdentityResolutionError } from "./steam-identity-resolver.js";

export const LIBRARY_ANALYSIS_POLICY = Object.freeze({
  abandonedMinimumPlaytimeMinutes: 1,
  abandonedMaximumPlaytimeMinutes: 119,
  abandonedInactiveDays: 180,
  maximumGenreEvidenceGames: 20,
  minimumGenreEvidenceGames: 3,
  maximumConcurrentGenreEnrichments: 4,
});

const DISTRIBUTION_BUCKETS = [
  "unplayed",
  "under_2_hours",
  "2_to_under_10_hours",
  "10_to_under_50_hours",
  "50_hours_or_more",
] as const;

type DistributionBucket = (typeof DISTRIBUTION_BUCKETS)[number];

interface SteamAnalyzeLibraryDependencies {
  readonly identityResolver: SteamIdentityResolver;
  readonly steamData: Pick<SteamDataPort, "getOwnedGames" | "getStoreGame">;
  readonly clock: Pick<ClockPort, "now">;
}

interface GenreScore {
  readonly name: string;
  readonly gameCount: number;
  readonly playtimeMinutes: number;
}

type FrequentGenres =
  | {
      readonly status: "available";
      readonly evidenceGameCount: number;
      readonly candidateGameCount: number;
      readonly maximumEvidenceGames: number;
      readonly minimumEvidenceGames: number;
      readonly scoring: "full_game_playtime_per_genre";
      readonly genres: readonly GenreScore[];
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        "insufficient_played_games" | "insufficient_genre_evidence";
      readonly evidenceGameCount: number;
      readonly candidateGameCount: number;
      readonly maximumEvidenceGames: number;
      readonly minimumEvidenceGames: number;
    };

export interface SteamLibraryAnalysis {
  readonly steamId: SteamId64;
  readonly libraryGameCount: number;
  readonly totalPlaytimeMinutes: number;
  readonly playtimeDistribution: readonly {
    readonly bucket: DistributionBucket;
    readonly count: number;
    readonly totalMinutes: number;
  }[];
  readonly backlog: {
    readonly count: number;
    readonly threshold: { readonly recordedPlaytimeMinutes: 0 };
  };
  readonly abandoned: {
    readonly count: number;
    readonly insufficientLastPlayedEvidenceCount: number;
    readonly threshold: {
      readonly minimumPlaytimeMinutes: number;
      readonly maximumPlaytimeMinutes: number;
      readonly inactiveDays: number;
    };
  };
  readonly frequentGenres: FrequentGenres;
}

export function createSteamAnalyzeLibraryService(
  dependencies: SteamAnalyzeLibraryDependencies,
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
      const abandoned = analyzeAbandoned(
        library.items,
        dependencies.clock.now(),
      );
      const genreAnalysis = await analyzeGenres(
        library.items,
        dependencies.steamData.getStoreGame.bind(dependencies.steamData),
        signal,
      );
      const warnings =
        genreAnalysis.unavailableCandidateCount === 0
          ? []
          : [
              `Genre evidence was unavailable for ${String(genreAnalysis.unavailableCandidateCount)} candidate games.`,
            ];
      return success<SteamLibraryAnalysis>(
        {
          steamId: identity.steamId,
          libraryGameCount: library.items.length,
          totalPlaytimeMinutes: library.items.reduce(
            (total, game) => total + game.playtimeMinutes,
            0,
          ),
          playtimeDistribution: analyzeDistribution(library.items),
          backlog: {
            count: library.items.filter((game) => game.playtimeMinutes === 0)
              .length,
            threshold: { recordedPlaytimeMinutes: 0 },
          },
          abandoned,
          frequentGenres: genreAnalysis.result,
        },
        genreAnalysis.sourceUsed
          ? ["supported", "best_effort", "derived"]
          : ["supported", "derived"],
        {
          partial: genreAnalysis.unavailableCandidateCount > 0,
          warnings,
        },
      );
    },
  };
}

function analyzeDistribution(games: readonly OwnedGame[]) {
  return DISTRIBUTION_BUCKETS.map((bucket) => {
    const matching = games.filter(
      (game) => playtimeBucket(game.playtimeMinutes) === bucket,
    );
    return {
      bucket,
      count: matching.length,
      totalMinutes: matching.reduce(
        (total, game) => total + game.playtimeMinutes,
        0,
      ),
    };
  });
}

function playtimeBucket(minutes: number): DistributionBucket {
  if (minutes === 0) return "unplayed";
  if (minutes < 120) return "under_2_hours";
  if (minutes < 600) return "2_to_under_10_hours";
  if (minutes < 3_000) return "10_to_under_50_hours";
  return "50_hours_or_more";
}

function analyzeAbandoned(games: readonly OwnedGame[], now: Date) {
  const candidates = games.filter(
    (game) =>
      game.playtimeMinutes >=
        LIBRARY_ANALYSIS_POLICY.abandonedMinimumPlaytimeMinutes &&
      game.playtimeMinutes <=
        LIBRARY_ANALYSIS_POLICY.abandonedMaximumPlaytimeMinutes,
  );
  const cutoff =
    now.getTime() -
    LIBRARY_ANALYSIS_POLICY.abandonedInactiveDays * 24 * 60 * 60 * 1_000;
  return {
    count: candidates.filter(
      (game) =>
        game.lastPlayedAt !== undefined &&
        new Date(game.lastPlayedAt).getTime() <= cutoff,
    ).length,
    insufficientLastPlayedEvidenceCount: candidates.filter(
      (game) => game.lastPlayedAt === undefined,
    ).length,
    threshold: {
      minimumPlaytimeMinutes:
        LIBRARY_ANALYSIS_POLICY.abandonedMinimumPlaytimeMinutes,
      maximumPlaytimeMinutes:
        LIBRARY_ANALYSIS_POLICY.abandonedMaximumPlaytimeMinutes,
      inactiveDays: LIBRARY_ANALYSIS_POLICY.abandonedInactiveDays,
    },
  };
}

async function analyzeGenres(
  games: readonly OwnedGame[],
  getStoreGame: SteamDataPort["getStoreGame"],
  signal: AbortSignal,
): Promise<{
  readonly result: FrequentGenres;
  readonly sourceUsed: boolean;
  readonly unavailableCandidateCount: number;
}> {
  const candidates = [...games]
    .filter((game) => game.playtimeMinutes > 0)
    .sort(
      (left, right) =>
        right.playtimeMinutes - left.playtimeMinutes ||
        left.appId - right.appId,
    )
    .slice(0, LIBRARY_ANALYSIS_POLICY.maximumGenreEvidenceGames);
  const common = {
    candidateGameCount: candidates.length,
    maximumEvidenceGames: LIBRARY_ANALYSIS_POLICY.maximumGenreEvidenceGames,
    minimumEvidenceGames: LIBRARY_ANALYSIS_POLICY.minimumGenreEvidenceGames,
  };
  if (candidates.length < LIBRARY_ANALYSIS_POLICY.minimumGenreEvidenceGames) {
    return {
      result: {
        status: "unavailable",
        reason: "insufficient_played_games",
        evidenceGameCount: 0,
        ...common,
      },
      sourceUsed: false,
      unavailableCandidateCount: 0,
    };
  }
  const details = await loadStoreDetails(candidates, getStoreGame, signal);
  const evidence = details.flatMap((result, index) => {
    if (result.status !== "fulfilled" || result.value === undefined) return [];
    const game = candidates[index];
    return game === undefined || result.value.genres.length === 0
      ? []
      : [{ game, details: result.value }];
  });
  const unavailableCandidateCount = candidates.length - evidence.length;
  if (evidence.length < LIBRARY_ANALYSIS_POLICY.minimumGenreEvidenceGames) {
    return {
      result: {
        status: "unavailable",
        reason: "insufficient_genre_evidence",
        evidenceGameCount: evidence.length,
        ...common,
      },
      sourceUsed: true,
      unavailableCandidateCount,
    };
  }
  return {
    result: {
      status: "available",
      evidenceGameCount: evidence.length,
      ...common,
      scoring: "full_game_playtime_per_genre",
      genres: scoreGenres(evidence),
    },
    sourceUsed: true,
    unavailableCandidateCount,
  };
}

async function loadStoreDetails(
  games: readonly OwnedGame[],
  getStoreGame: SteamDataPort["getStoreGame"],
  signal: AbortSignal,
): Promise<readonly PromiseSettledResult<StoreGameDetails | undefined>[]> {
  const results: PromiseSettledResult<StoreGameDetails | undefined>[] = [];
  for (
    let start = 0;
    start < games.length;
    start += LIBRARY_ANALYSIS_POLICY.maximumConcurrentGenreEnrichments
  ) {
    results.push(
      ...(await Promise.allSettled(
        games
          .slice(
            start,
            start + LIBRARY_ANALYSIS_POLICY.maximumConcurrentGenreEnrichments,
          )
          .map((game) => getStoreGame(game.appId, signal)),
      )),
    );
  }
  return results;
}

function scoreGenres(
  evidence: readonly {
    readonly game: OwnedGame;
    readonly details: StoreGameDetails;
  }[],
): readonly GenreScore[] {
  const scores = new Map<
    string,
    { gameCount: number; playtimeMinutes: number }
  >();
  for (const { game, details } of evidence) {
    for (const genre of new Set(details.genres)) {
      const current = scores.get(genre) ?? { gameCount: 0, playtimeMinutes: 0 };
      scores.set(genre, {
        gameCount: current.gameCount + 1,
        playtimeMinutes: current.playtimeMinutes + game.playtimeMinutes,
      });
    }
  }
  return [...scores.entries()]
    .map(([name, score]) => ({ name, ...score }))
    .sort(
      (left, right) =>
        right.playtimeMinutes - left.playtimeMinutes ||
        (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
    );
}
