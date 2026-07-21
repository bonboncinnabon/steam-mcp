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
