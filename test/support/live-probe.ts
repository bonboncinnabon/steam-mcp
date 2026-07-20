import { parseSteamId64, type SteamId64 } from "../../src/domain/steam-id.js";

export const LIVE_PROBE_NAMES = [
  "supported_player",
  "wishlist",
  "store_search",
  "store_details",
  "deck",
  "reviews",
  "tags",
] as const;

export type LiveProbeName = (typeof LIVE_PROBE_NAMES)[number];

const LIVE_PROBE_OUTCOMES = ["passed", "drifted", "unavailable"] as const;
type LiveProbeOutcome = (typeof LIVE_PROBE_OUTCOMES)[number];

export interface LiveProbeMetric {
  readonly probe: LiveProbeName;
  readonly outcome: LiveProbeOutcome;
  readonly count: number;
}

export class LiveProbeMetrics {
  readonly #counts = new Map<string, number>();

  record(probe: LiveProbeName, outcome: LiveProbeOutcome): void {
    if (
      !LIVE_PROBE_NAMES.includes(probe) ||
      !LIVE_PROBE_OUTCOMES.includes(outcome)
    ) {
      throw new TypeError("Unknown live Steam probe metric dimension");
    }
    const key = `${probe}:${outcome}`;
    this.#counts.set(key, (this.#counts.get(key) ?? 0) + 1);
  }

  snapshot(): readonly LiveProbeMetric[] {
    const metrics: LiveProbeMetric[] = [];
    for (const probe of LIVE_PROBE_NAMES) {
      for (const outcome of LIVE_PROBE_OUTCOMES) {
        const count = this.#counts.get(`${probe}:${outcome}`);
        if (count !== undefined) {
          metrics.push({ probe, outcome, count });
        }
      }
    }
    return metrics;
  }
}

export interface LiveProbeEnvironment {
  readonly apiKey: string;
  readonly steamId: SteamId64;
}

export function readLiveProbeEnvironment(
  environment: NodeJS.ProcessEnv,
): LiveProbeEnvironment {
  const apiKey = environment["STEAM_LIVE_TEST_API_KEY"]?.trim();
  const steamId = environment["STEAM_LIVE_TEST_STEAM_ID"]?.trim();
  if (apiKey === undefined || apiKey === "" || steamId === undefined) {
    throw new TypeError("Live Steam probe configuration is incomplete");
  }
  return { apiKey, steamId: parseSteamId64(steamId) };
}
