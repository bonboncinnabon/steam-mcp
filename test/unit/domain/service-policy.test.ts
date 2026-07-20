import { describe, expect, it } from "vitest";

import {
  BASELINE_SERVICE_POLICY,
  createServicePolicy,
} from "../../../src/domain/service-policy.js";

describe("BASELINE_SERVICE_POLICY", () => {
  it("centralizes every bounded service behavior", () => {
    expect(BASELINE_SERVICE_POLICY).toEqual({
      upstreamTimeoutMs: 8_000,
      maxRetryAttempts: 2,
      globalDailyQuota: 80_000,
      globalSafetyReserve: 20_000,
      perUserDailyQuota: 500,
      cacheTtlSeconds: 300,
      maxHostConcurrency: 8,
      maxOperationConcurrency: 4,
      maxToolFanOut: 20,
      defaultPageSize: 20,
      maxPageSize: 100,
      executionDeadlineMs: 30_000,
      maxOutputBytes: 256_000,
    });
  });
});

describe("createServicePolicy", () => {
  it("merges a bounded override with the baseline policy", () => {
    expect(createServicePolicy({ maxPageSize: 50 }).maxPageSize).toBe(50);
  });

  it("rejects zero for every strictly positive service limit", () => {
    const fields = [
      "upstreamTimeoutMs",
      "globalDailyQuota",
      "perUserDailyQuota",
      "maxHostConcurrency",
      "maxOperationConcurrency",
      "maxToolFanOut",
      "defaultPageSize",
      "maxPageSize",
      "executionDeadlineMs",
      "maxOutputBytes",
    ] as const;

    const rejected = fields.map((field) => {
      try {
        createServicePolicy({ [field]: 0 });
        return false;
      } catch {
        return true;
      }
    });

    expect(rejected).toEqual(fields.map(() => true));
  });

  it("rejects negative or fractional values for non-negative limits", () => {
    const fields = [
      "maxRetryAttempts",
      "globalSafetyReserve",
      "cacheTtlSeconds",
    ] as const;
    const invalidValues = [-1, 0.5];

    const rejected = fields.flatMap((field) =>
      invalidValues.map((value) => {
        try {
          createServicePolicy({ [field]: value });
          return false;
        } catch {
          return true;
        }
      }),
    );

    expect(rejected).toEqual(rejected.map(() => true));
  });

  it("rejects inconsistent policy relationships", () => {
    const invalidPolicies: Partial<
      Parameters<typeof createServicePolicy>[0]
    >[] = [
      { globalDailyQuota: 100, globalSafetyReserve: 101 },
      {
        globalDailyQuota: 100,
        globalSafetyReserve: 20,
        perUserDailyQuota: 81,
      },
      { defaultPageSize: 101, maxPageSize: 100 },
      { maxHostConcurrency: 4, maxOperationConcurrency: 5 },
      { upstreamTimeoutMs: 30_001, executionDeadlineMs: 30_000 },
    ];

    const rejected = invalidPolicies.map((overrides) => {
      try {
        createServicePolicy(overrides);
        return false;
      } catch {
        return true;
      }
    });

    expect(rejected).toEqual(invalidPolicies.map(() => true));
  });

  it("rejects values above hard operational ceilings", () => {
    const invalidPolicies: NonNullable<
      Parameters<typeof createServicePolicy>[0]
    >[] = [
      { upstreamTimeoutMs: 60_001, executionDeadlineMs: 120_000 },
      { maxRetryAttempts: 6 },
      { globalDailyQuota: 100_001 },
      { perUserDailyQuota: 10_001 },
      { cacheTtlSeconds: 86_401 },
      { maxHostConcurrency: 65 },
      { maxHostConcurrency: 64, maxOperationConcurrency: 33 },
      { maxToolFanOut: 101 },
      { maxPageSize: 201 },
      { executionDeadlineMs: 120_001 },
      { maxOutputBytes: 1_048_577 },
    ];

    const rejected = invalidPolicies.map((overrides) => {
      try {
        createServicePolicy(overrides);
        return false;
      } catch {
        return true;
      }
    });

    expect(rejected).toEqual(invalidPolicies.map(() => true));
  });
});
