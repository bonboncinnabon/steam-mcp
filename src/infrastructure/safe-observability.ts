import type {
  OperationalEvent,
  ObservabilityPort,
  ToolOutcomeMetric,
} from "../application/ports/observability.js";
import { ERROR_CODES, SOURCE_TIERS } from "../domain/result.js";

const MAX_SECRETS = 32;
const MAX_DEPTH = 4;
const MAX_COLLECTION_ENTRIES = 16;
const MAX_STRING_LENGTH = 512;

const TOOL_NAMES = new Set([
  "steam_get_player",
  "steam_get_library",
  "steam_get_recent_activity",
  "steam_get_achievements",
  "steam_get_friends",
  "steam_get_wishlist",
  "steam_search_games",
  "steam_get_game",
]);

const BEST_EFFORT_ADAPTERS = new Set([
  "wishlist",
  "store_search",
  "store_details",
  "deck_compatibility",
  "store_tags",
  "aggregate_reviews",
]);

const ERROR_CODE_SET = new Set<string>(ERROR_CODES);
const SOURCE_TIER_SET = new Set<string>(SOURCE_TIERS);
const STATUS_CLASSES = new Set(["2xx", "4xx", "5xx"]);
const AUTHENTICATION_REASONS = new Set(["missing_token", "invalid_token"]);
const QUOTA_REASONS = new Set(["global_reserve", "unavailable"]);
const SHUTDOWN_PHASES = new Set([
  "started",
  "drained",
  "deadline_exceeded",
  "completed",
]);
const DEPENDENCIES = new Set(["quota", "steam"]);
const FAILURE_KINDS = new Set([
  "timeout",
  "unavailable",
  "malformed_response",
  "internal",
]);
const SENSITIVE_KEY =
  /^(authorization|body|key|password|prompt|secret|steam_?id|subject|token|tool_arguments|user)$/i;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/giu;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/giu;
const STEAM_KEY_PATTERN = /\b[A-Fa-f0-9]{32}\b/gu;
const ANSI_TAIL_PATTERN = /\[[0-9;]*m/gu;
const CONTROL_PATTERN = /\p{Cc}+/gu;

type TelemetryPrimitive = string | number | boolean;

export type SafeTelemetryRecord =
  | {
      readonly kind: "metric";
      readonly name: "tool_outcome";
      readonly labels: Readonly<Record<string, string>>;
      readonly value: { readonly duration_ms: number };
    }
  | {
      readonly kind: "metric";
      readonly name: "best_effort_drift";
      readonly labels: { readonly adapter: string };
      readonly value: { readonly count: 1 };
    }
  | {
      readonly kind: "event";
      readonly name: string;
      readonly attributes: Readonly<Record<string, TelemetryPrimitive>>;
    };

export interface TelemetryRedactionOptions {
  readonly secrets: readonly string[];
}

export interface SafeObservabilityOptions extends TelemetryRedactionOptions {
  readonly emit: (record: SafeTelemetryRecord) => void;
}

export type SafeObservability = ObservabilityPort;

function validateSecrets(secrets: readonly string[]): void {
  if (
    secrets.length > MAX_SECRETS ||
    secrets.some((secret) => secret.length === 0)
  ) {
    throw new Error("Invalid telemetry redaction configuration");
  }
}

function redactString(value: string, secrets: readonly string[]): string {
  let redacted = value
    .replace(CONTROL_PATTERN, " ")
    .replace(ANSI_TAIL_PATTERN, "")
    .replace(/\s+/gu, " ")
    .trim();
  for (const secret of [...secrets].sort(
    (left, right) => right.length - left.length,
  )) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  redacted = redacted.replace(BEARER_PATTERN, "Bearer [REDACTED]");
  redacted = redacted.replace(STEAM_KEY_PATTERN, "[REDACTED]");
  redacted = redacted.replace(URL_PATTERN, "[REDACTED_URL]");
  return redacted.length > MAX_STRING_LENGTH
    ? `${redacted.slice(0, MAX_STRING_LENGTH)}[TRUNCATED]`
    : redacted;
}

function ownDescriptor(
  descriptors: PropertyDescriptorMap,
  key: string,
): PropertyDescriptor | undefined {
  return Object.hasOwn(descriptors, key) ? descriptors[key] : undefined;
}

function redactValue(
  value: unknown,
  secrets: readonly string[],
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (typeof value === "string") {
    return redactString(value, secrets);
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    return redactString(value.toString(), secrets);
  }
  if (typeof value !== "object") {
    return `[${(typeof value).toUpperCase()}]`;
  }
  if (depth >= MAX_DEPTH) {
    return "[TRUNCATED]";
  }
  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);

  if (value instanceof Error) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const messageDescriptor = ownDescriptor(descriptors, "message");
    const message: unknown =
      messageDescriptor === undefined
        ? undefined
        : (messageDescriptor.value as unknown);
    const result: Record<string, unknown> = {
      name: value instanceof AggregateError ? "AggregateError" : "Error",
      message:
        typeof message === "string"
          ? redactString(message, secrets)
          : "[UNAVAILABLE]",
    };
    const cause = ownDescriptor(descriptors, "cause");
    if (cause !== undefined) {
      result["cause"] =
        "value" in cause
          ? redactValue(cause.value, secrets, seen, depth + 1)
          : "[ACCESSOR]";
    }
    const errors = ownDescriptor(descriptors, "errors");
    if (value instanceof AggregateError && errors !== undefined) {
      result["errors"] =
        "value" in errors
          ? redactValue(errors.value, secrets, seen, depth + 1)
          : "[ACCESSOR]";
    }
    return result;
  }

  if (Array.isArray(value)) {
    const result = value
      .slice(0, MAX_COLLECTION_ENTRIES)
      .map((entry) => redactValue(entry, secrets, seen, depth + 1));
    if (value.length > MAX_COLLECTION_ENTRIES) {
      result.push("[TRUNCATED]");
    }
    return result;
  }

  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return "[UNAVAILABLE]";
  }
  const entries = Object.entries(descriptors).filter(
    ([, descriptor]) => descriptor.enumerable === true,
  );
  const result: Record<string, unknown> = {};
  for (const [key, descriptor] of entries.slice(0, MAX_COLLECTION_ENTRIES)) {
    const safeKey = redactString(key, secrets);
    result[safeKey] = SENSITIVE_KEY.test(key)
      ? "[REDACTED]"
      : "value" in descriptor
        ? redactValue(descriptor.value, secrets, seen, depth + 1)
        : "[ACCESSOR]";
  }
  if (entries.length > MAX_COLLECTION_ENTRIES) {
    result["truncated"] = "[TRUNCATED]";
  }
  return result;
}

export function redactTelemetryValue(
  value: unknown,
  options: TelemetryRedactionOptions,
): unknown {
  validateSecrets(options.secrets);
  return redactValue(value, options.secrets, new WeakSet(), 0);
}

function safeOperationalEvent(event: OperationalEvent): {
  readonly name: string;
  readonly attributes: Readonly<Record<string, TelemetryPrimitive>>;
} {
  const candidate = event as unknown as Record<string, unknown>;
  if (
    candidate["name"] === "authentication_rejected" &&
    typeof candidate["reason"] === "string" &&
    AUTHENTICATION_REASONS.has(candidate["reason"])
  ) {
    return {
      name: "authentication_rejected",
      attributes: { reason: candidate["reason"] },
    };
  }
  if (
    candidate["name"] === "quota_rejected" &&
    typeof candidate["reason"] === "string" &&
    QUOTA_REASONS.has(candidate["reason"])
  ) {
    return {
      name: "quota_rejected",
      attributes: { reason: candidate["reason"] },
    };
  }
  if (
    candidate["name"] === "shutdown" &&
    typeof candidate["phase"] === "string" &&
    SHUTDOWN_PHASES.has(candidate["phase"])
  ) {
    return {
      name: "shutdown",
      attributes: { phase: candidate["phase"] },
    };
  }
  if (
    candidate["name"] === "dependency_failure" &&
    typeof candidate["dependency"] === "string" &&
    DEPENDENCIES.has(candidate["dependency"]) &&
    typeof candidate["failureKind"] === "string" &&
    FAILURE_KINDS.has(candidate["failureKind"])
  ) {
    return {
      name: "dependency_failure",
      attributes: {
        dependency: candidate["dependency"],
        failure_kind: candidate["failureKind"],
      },
    };
  }
  return { name: "unknown_event", attributes: {} };
}

function toolOutcomeRecord(metric: ToolOutcomeMetric): SafeTelemetryRecord {
  const labels: Record<string, string> = {
    tool: TOOL_NAMES.has(metric.tool) ? metric.tool : "unknown",
  };
  if (metric.errorCode !== undefined && ERROR_CODE_SET.has(metric.errorCode)) {
    labels["error_code"] = metric.errorCode;
  }
  const sourceTiers = [...new Set(metric.sourceTiers)]
    .filter((tier) => SOURCE_TIER_SET.has(tier))
    .sort();
  if (sourceTiers.length > 0) {
    labels["source_tiers"] = sourceTiers.join(",");
  }
  if (
    metric.statusClass !== undefined &&
    STATUS_CLASSES.has(metric.statusClass)
  ) {
    labels["status_class"] = metric.statusClass;
  }
  const durationMs =
    Number.isFinite(metric.durationMs) && metric.durationMs >= 0
      ? Math.min(60_000, Math.round(metric.durationMs))
      : 0;
  return {
    kind: "metric",
    name: "tool_outcome",
    labels,
    value: { duration_ms: durationMs },
  };
}

export function createSafeObservability(
  options: SafeObservabilityOptions,
): SafeObservability {
  validateSecrets(options.secrets);
  const emit = (record: SafeTelemetryRecord) => {
    try {
      options.emit(record);
    } catch {
      // Telemetry is deliberately best-effort and cannot affect tool behavior.
    }
  };

  return {
    recordToolOutcome(metric) {
      emit(toolOutcomeRecord(metric));
    },
    recordBestEffortDrift(adapter) {
      emit({
        kind: "metric",
        name: "best_effort_drift",
        labels: {
          adapter: BEST_EFFORT_ADAPTERS.has(adapter) ? adapter : "unknown",
        },
        value: { count: 1 },
      });
    },
    recordEvent(event) {
      const safeEvent = safeOperationalEvent(event);
      emit({
        kind: "event",
        name: safeEvent.name,
        attributes: safeEvent.attributes,
      });
    },
  };
}
