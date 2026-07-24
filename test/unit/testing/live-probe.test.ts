import { describe, expect, it } from "vitest";

import {
  LiveProbeMetrics,
  readLiveProbeEnvironment,
  type LiveProbeName,
} from "../../../test/support/live-probe.js";

describe("live probe metrics", () => {
  it("records only fixed probe and outcome dimensions", () => {
    const metrics = new LiveProbeMetrics();

    metrics.record("store_search", "passed", 1);
    metrics.record("store_search", "drifted", 2);

    expect(metrics.snapshot()).toEqual([
      {
        probe: "store_search",
        outcome: "passed",
        count: 1,
        observedCalls: 1,
      },
      {
        probe: "store_search",
        outcome: "drifted",
        count: 1,
        observedCalls: 2,
      },
    ]);
    expect(() => {
      metrics.record("unbounded-user-input" as LiveProbeName, "passed", 1);
    }).toThrow("Unknown live Steam probe metric dimension");
  });

  it("requires dedicated probe variables without exposing their values", () => {
    expect(
      readLiveProbeEnvironment({
        STEAM_LIVE_TEST_API_KEY: "synthetic-dedicated-key",
        STEAM_LIVE_TEST_STEAM_ID: "76561198000000000",
      }),
    ).toEqual({
      apiKey: "synthetic-dedicated-key",
      steamId: "76561198000000000",
    });

    expect(() => {
      readLiveProbeEnvironment({
        STEAM_LIVE_TEST_API_KEY: "must-not-appear-in-the-error",
      });
    }).toThrow("Live Steam probe configuration is incomplete");
  });
});
