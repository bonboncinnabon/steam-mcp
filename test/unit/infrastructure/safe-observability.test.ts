import { describe, expect, it, vi } from "vitest";

import {
  createSafeObservability,
  redactTelemetryValue,
  type SafeTelemetryRecord,
} from "../../../src/infrastructure/safe-observability.js";

describe("redactTelemetryValue", () => {
  it("scrubs configured secrets, bearer tokens, sensitive fields, and credential URLs", () => {
    const secret = "0123456789ABCDEF0123456789ABCDEF";
    const nested = new Error(
      `request failed at https://api.steampowered.com/test?key=${secret}&steamid=76561198000000000`,
      {
        cause: {
          authorization: "Bearer oauth.private.token",
          body: { games: [1, 2, 3] },
          note: `Bearer oauth.private.token credential ${secret}`,
        },
      },
    );

    const redacted = redactTelemetryValue(nested, { secrets: [secret] });
    const serialized = JSON.stringify(redacted);

    expect(serialized).toContain("[REDACTED_URL]");
    expect(serialized).toContain("Bearer [REDACTED]");
    expect(serialized).toContain('"body":"[REDACTED]"');
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("76561198000000000");
    expect(serialized).not.toContain("oauth.private.token");
  });

  it("bounds depth, collection size, keys, strings, and cycles", () => {
    const cyclic: Record<string, unknown> = {
      long: "x".repeat(2_000),
      list: Array.from({ length: 40 }, (_, index) => index),
    };
    cyclic["self"] = cyclic;
    cyclic["deep"] = { one: { two: { three: { four: { five: true } } } } };

    const redacted = redactTelemetryValue(cyclic, { secrets: [] });
    const serialized = JSON.stringify(redacted);

    expect(serialized.length).toBeLessThan(2_000);
    expect(serialized).toContain("[CIRCULAR]");
    expect(serialized).toContain("[TRUNCATED]");
    expect((redacted as { list: unknown[] }).list).toHaveLength(17);
  });

  it("scrubs overlapping secrets, raw Steam-style keys, URLs, and log controls", () => {
    const value =
      "\u001b[31mline\r\n https://steamcommunity.com/id/private-name " +
      "ABCDEF0123456789ABCDEF0123456789 secret-long secret";

    const redacted = redactTelemetryValue(value, {
      secrets: ["secret", "secret-long"],
    });

    expect(redacted).toBe(
      "line [REDACTED_URL] [REDACTED] [REDACTED] [REDACTED]",
    );
  });

  it("normalizes uncommon diagnostic primitives and errors without causes", () => {
    expect(redactTelemetryValue(42n, { secrets: [] })).toBe("42");
    expect(redactTelemetryValue(undefined, { secrets: [] })).toBe(
      "[UNDEFINED]",
    );
    expect(redactTelemetryValue(Symbol("private"), { secrets: [] })).toBe(
      "[SYMBOL]",
    );
    expect(
      redactTelemetryValue(new Error("safe fixed message"), { secrets: [] }),
    ).toEqual({ name: "Error", message: "safe fixed message" });
  });

  it("bounds wide objects and preserves bounded arrays without a marker", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [String(index), index]),
    );

    expect(redactTelemetryValue([1, 2], { secrets: [] })).toEqual([1, 2]);
    expect(redactTelemetryValue(wide, { secrets: [] })).toMatchObject({
      truncated: "[TRUNCATED]",
    });
  });

  it("does not invoke hostile getters or proxy traps", () => {
    const getter = vi.fn(() => {
      throw new Error("getter must not run");
    });
    const object = Object.defineProperty({}, "private", {
      enumerable: true,
      get: getter,
    });
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("private proxy detail");
        },
      },
    );

    expect(redactTelemetryValue(object, { secrets: [] })).toEqual({
      private: "[ACCESSOR]",
    });
    expect(getter).not.toHaveBeenCalled();
    expect(redactTelemetryValue(proxy, { secrets: [] })).toBe("[UNAVAILABLE]");
  });

  it("scrubs every nested AggregateError entry", () => {
    const secret = "aggregate-private-token";
    const aggregate = new AggregateError(
      [new Error(`Bearer ${secret}`), { key: secret }],
      `failed at https://example.test/path?token=${secret}`,
    );

    const serialized = JSON.stringify(
      redactTelemetryValue(aggregate, { secrets: [secret] }),
    );

    expect(serialized).toContain("AggregateError");
    expect(serialized).toContain("[REDACTED_URL]");
    expect(serialized).not.toContain(secret);
  });

  it("handles missing, non-string, and accessor Error fields safely", () => {
    const missingMessage = Object.create(Error.prototype) as Error;
    const nonStringMessage = new Error("replaced");
    Object.defineProperty(nonStringMessage, "message", { value: 42 });
    const causeAccessor = new Error("safe");
    Object.defineProperty(causeAccessor, "cause", { get: vi.fn() });
    const errorsAccessor = new AggregateError([], "safe");
    Object.defineProperty(errorsAccessor, "errors", { get: vi.fn() });

    expect(redactTelemetryValue(missingMessage, { secrets: [] })).toEqual({
      name: "Error",
      message: "[UNAVAILABLE]",
    });
    expect(redactTelemetryValue(nonStringMessage, { secrets: [] })).toEqual({
      name: "Error",
      message: "[UNAVAILABLE]",
    });
    expect(redactTelemetryValue(causeAccessor, { secrets: [] })).toEqual({
      name: "Error",
      message: "safe",
      cause: "[ACCESSOR]",
    });
    expect(redactTelemetryValue(errorsAccessor, { secrets: [] })).toEqual({
      name: "AggregateError",
      message: "safe",
      errors: "[ACCESSOR]",
    });
  });

  it.each([
    [[""]],
    [Array.from({ length: 33 }, (_, index) => "s-" + String(index))],
  ])("rejects unsafe secret configuration %#", (secrets) => {
    expect(() => redactTelemetryValue("value", { secrets })).toThrow(
      "Invalid telemetry redaction configuration",
    );
  });
});

describe("createSafeObservability", () => {
  it("emits bounded tool outcome labels and a finite latency value", () => {
    const records: SafeTelemetryRecord[] = [];
    const observability = createSafeObservability({
      emit: (record) => records.push(record),
      secrets: [],
    });

    observability.recordToolOutcome({
      tool: "unbounded-user-value" as "steam_get_player",
      durationMs: Number.POSITIVE_INFINITY,
      errorCode: "INTERNAL_ERROR",
      sourceTiers: ["best_effort", "supported", "best_effort"],
      statusClass: "5xx",
    });

    expect(records).toEqual([
      {
        kind: "metric",
        name: "tool_outcome",
        labels: {
          tool: "unknown",
          error_code: "INTERNAL_ERROR",
          source_tiers: "best_effort,supported",
          status_class: "5xx",
        },
        value: { duration_ms: 0 },
      },
    ]);
  });

  it("omits invalid optional dimensions and clamps valid latency", () => {
    const records: SafeTelemetryRecord[] = [];
    const observability = createSafeObservability({
      emit: (record) => records.push(record),
      secrets: [],
    });

    observability.recordToolOutcome({
      tool: "steam_get_game",
      durationMs: 90_000.4,
      errorCode: "private" as "INTERNAL_ERROR",
      sourceTiers: ["private" as "supported"],
      statusClass: "3xx" as "2xx",
    });
    observability.recordToolOutcome({
      tool: "steam_get_player",
      durationMs: 1.6,
      sourceTiers: [],
    });

    expect(records).toEqual([
      {
        kind: "metric",
        name: "tool_outcome",
        labels: { tool: "steam_get_game" },
        value: { duration_ms: 60_000 },
      },
      {
        kind: "metric",
        name: "tool_outcome",
        labels: { tool: "steam_get_player" },
        value: { duration_ms: 2 },
      },
    ]);
  });

  it("emits only fixed privacy-preserving drift labels", () => {
    const records: SafeTelemetryRecord[] = [];
    const observability = createSafeObservability({
      emit: (record) => records.push(record),
      secrets: [],
    });

    observability.recordBestEffortDrift("store_search");
    observability.recordBestEffortDrift("76561198000000000" as "store_search");

    expect(records).toEqual([
      {
        kind: "metric",
        name: "best_effort_drift",
        labels: { adapter: "store_search" },
        value: { count: 1 },
      },
      {
        kind: "metric",
        name: "best_effort_drift",
        labels: { adapter: "unknown" },
        value: { count: 1 },
      },
    ]);
  });

  it("drops unapproved event attributes", () => {
    const records: SafeTelemetryRecord[] = [];
    const observability = createSafeObservability({
      emit: (record) => records.push(record),
      secrets: [],
    });

    observability.recordEvent({
      name: "authorization_rejected",
      reason: "invalid_token",
      subject: "oauth-subject-must-not-appear",
      tool_arguments: "private input",
    } as never);

    expect(records).toEqual([
      {
        kind: "event",
        name: "authorization_rejected",
        attributes: { reason: "invalid_token" },
      },
    ]);
  });

  it.each([
    [
      { name: "quota_rejected", reason: "global_reserve" },
      { name: "quota_rejected", attributes: { reason: "global_reserve" } },
    ],
    [
      { name: "shutdown", phase: "deadline_exceeded" },
      { name: "shutdown", attributes: { phase: "deadline_exceeded" } },
    ],
    [
      {
        name: "dependency_failure",
        dependency: "steam",
        failureKind: "timeout",
      },
      {
        name: "dependency_failure",
        attributes: { dependency: "steam", failure_kind: "timeout" },
      },
    ],
  ])("emits bounded event %#", (event, expected) => {
    const records: SafeTelemetryRecord[] = [];
    const observability = createSafeObservability({
      emit: (record) => records.push(record),
      secrets: [],
    });

    observability.recordEvent(event as never);

    expect(records).toEqual([{ kind: "event", ...expected }]);
  });

  it.each([
    { name: "authorization_rejected", reason: 1 },
    { name: "authorization_rejected", reason: "private" },
    { name: "quota_rejected", reason: 1 },
    { name: "quota_rejected", reason: "private" },
    { name: "shutdown", phase: 1 },
    { name: "shutdown", phase: "private" },
    { name: "dependency_failure", dependency: 1, failureKind: "timeout" },
    {
      name: "dependency_failure",
      dependency: "private",
      failureKind: "timeout",
    },
    { name: "dependency_failure", dependency: "steam", failureKind: 1 },
    {
      name: "dependency_failure",
      dependency: "steam",
      failureKind: "private",
    },
    { name: "private", subject: "must-not-appear" },
  ])("maps invalid runtime event %# to a fixed unknown event", (event) => {
    const records: SafeTelemetryRecord[] = [];
    const observability = createSafeObservability({
      emit: (record) => records.push(record),
      secrets: [],
    });

    observability.recordEvent(event as never);

    expect(records).toEqual([
      { kind: "event", name: "unknown_event", attributes: {} },
    ]);
  });

  it("contains sink failures so telemetry cannot break tool execution", () => {
    const observability = createSafeObservability({
      emit: vi.fn(() => {
        throw new Error("sink unavailable");
      }),
      secrets: [],
    });

    expect(() => {
      observability.recordEvent({ name: "shutdown", phase: "started" });
    }).not.toThrow();
  });
});
