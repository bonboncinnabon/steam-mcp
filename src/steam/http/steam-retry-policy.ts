import type { ErrorCode } from "../../domain/result.js";

const RETRYABLE_SERVER_STATUSES = new Set([500, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  "EAI_AGAIN",
  "ECONNRESET",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
]);

export interface SteamRetryDecision {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
}

export class SteamUpstreamError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(decision: SteamRetryDecision) {
    super(
      decision.code === "STEAM_AUTH_FAILED"
        ? "Steam authentication failed"
        : decision.code === "STEAM_RATE_LIMITED"
          ? "Steam rate limit reached"
          : "Steam upstream unavailable",
    );
    this.code = decision.code;
    this.retryable = decision.retryable;
    if (decision.retryAfterMs !== undefined) {
      this.retryAfterMs = decision.retryAfterMs;
    }
  }
}

interface SteamRetryDelayOptions {
  readonly attempt: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly retryAfterMs?: number;
  readonly random: () => number;
}

export function calculateSteamRetryDelay(
  options: SteamRetryDelayOptions,
): number {
  const exponentialDelay = Math.min(
    options.maxDelayMs,
    options.baseDelayMs * 2 ** options.attempt,
  );
  const jitteredDelay = Math.floor(options.random() * exponentialDelay);
  return Math.min(
    options.maxDelayMs,
    Math.max(jitteredDelay, options.retryAfterMs ?? 0),
  );
}

export function classifySteamHttpStatus(
  status: number,
  headers: Headers = new Headers(),
  nowMs: number = Date.now(),
): SteamRetryDecision {
  if (status === 401 || status === 403) {
    return { code: "STEAM_AUTH_FAILED", retryable: false };
  }

  if (status === 429) {
    const retryAfter = headers.get("retry-after");
    const retryAfterMs = parseRetryAfter(retryAfter, nowMs);
    return {
      code: "STEAM_RATE_LIMITED",
      retryable: true,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
  }

  if (RETRYABLE_SERVER_STATUSES.has(status)) {
    return { code: "UPSTREAM_UNAVAILABLE", retryable: true };
  }

  return { code: "UPSTREAM_UNAVAILABLE", retryable: false };
}

export function classifySteamNetworkFailure(
  error: unknown,
): SteamRetryDecision {
  const code = readErrorCode(error) ?? readErrorCode(readErrorCause(error));

  return {
    code: "UPSTREAM_UNAVAILABLE",
    retryable: typeof code === "string" && RETRYABLE_NETWORK_CODES.has(code),
  };
}

function readErrorCode(value: unknown): unknown {
  return typeof value === "object" && value !== null && "code" in value
    ? value.code
    : undefined;
}

function readErrorCause(value: unknown): unknown {
  return typeof value === "object" && value !== null && "cause" in value
    ? value.cause
    : undefined;
}

function parseRetryAfter(
  value: string | null,
  nowMs: number,
): number | undefined {
  if (value === null) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }

  const dateMs = Date.parse(value);
  return Number.isNaN(dateMs) ? undefined : Math.max(0, dateMs - nowMs);
}
