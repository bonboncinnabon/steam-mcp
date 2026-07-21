import { describe, expect, it } from "vitest";

import {
  createInMemoryQuota,
  deriveQuotaSubjectKey,
} from "../../../src/infrastructure/in-memory-quota.js";

describe("in-memory quota", () => {
  it("derives a fixed opaque key instead of retaining a raw OAuth subject", () => {
    const key = deriveQuotaSubjectKey("issuer|person@example.test");

    expect(key).toMatch(/^[a-f\d]{64}$/);
    expect(key).not.toContain("person@example.test");
    expect(deriveQuotaSubjectKey("issuer|person@example.test")).toBe(key);
    expect(deriveQuotaSubjectKey("issuer|other@example.test")).not.toBe(key);
  });

  it("deducts configured cost from subject and usable global budgets", async () => {
    const quota = createInMemoryQuota({
      globalDailyQuota: 10,
      globalSafetyReserve: 2,
      perUserDailyQuota: 5,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });

    await expect(
      quota.reserve({ subject: "oauth-subject", operation: "player", cost: 2 }),
    ).resolves.toMatchObject({ reserved: true, remaining: 3 });
  });

  it("rejects subject exhaustion without consuming global capacity", async () => {
    const quota = createInMemoryQuota({
      globalDailyQuota: 10,
      globalSafetyReserve: 0,
      perUserDailyQuota: 6,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });

    await quota.reserve({ subject: "first", operation: "library", cost: 4 });
    await expect(
      quota.reserve({ subject: "first", operation: "library", cost: 3 }),
    ).resolves.toEqual({ reserved: false, reason: "user_exhausted" });
    await expect(
      quota.reserve({ subject: "second", operation: "library", cost: 6 }),
    ).resolves.toMatchObject({ reserved: true, remaining: 0 });
  });

  it("preserves the configured global safety reserve", async () => {
    const quota = createInMemoryQuota({
      globalDailyQuota: 10,
      globalSafetyReserve: 3,
      perUserDailyQuota: 7,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });

    await quota.reserve({ subject: "first", operation: "game", cost: 5 });
    await expect(
      quota.reserve({ subject: "second", operation: "game", cost: 3 }),
    ).resolves.toEqual({ reserved: false, reason: "global_reserve" });
    await expect(
      quota.reserve({ subject: "second", operation: "game", cost: 2 }),
    ).resolves.toMatchObject({ reserved: true, remaining: 5 });
  });

  it("resets counters at the next UTC day", async () => {
    let now = new Date("2026-07-22T23:59:59.999Z");
    const quota = createInMemoryQuota({
      globalDailyQuota: 5,
      globalSafetyReserve: 0,
      perUserDailyQuota: 5,
      now: () => now,
    });

    await quota.reserve({ subject: "same", operation: "player", cost: 5 });
    now = new Date("2026-07-23T00:00:00.000Z");

    await expect(
      quota.reserve({ subject: "same", operation: "player", cost: 5 }),
    ).resolves.toMatchObject({ reserved: true, remaining: 0 });
  });

  it("rejects malformed requests before mutating quota state", async () => {
    const quota = createInMemoryQuota({
      globalDailyQuota: 5,
      globalSafetyReserve: 0,
      perUserDailyQuota: 5,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });

    const malformed = [
      { subject: "", operation: "player", cost: 1 },
      { subject: "oauth-subject", operation: "", cost: 1 },
      { subject: "oauth-subject", operation: "player", cost: 0 },
      { subject: "oauth-subject", operation: "player", cost: 1.5 },
      { subject: "oauth-subject", operation: "player", cost: Number.NaN },
      {
        subject: "oauth-subject",
        operation: "player",
        cost: Number.POSITIVE_INFINITY,
      },
      {
        subject: "oauth-subject",
        operation: "player",
        cost: Number.MAX_SAFE_INTEGER + 1,
      },
    ];
    for (const request of malformed) {
      await expect(quota.reserve(request)).rejects.toBeInstanceOf(RangeError);
    }

    await expect(
      quota.reserve({ subject: "valid", operation: "player", cost: 5 }),
    ).resolves.toMatchObject({ reserved: true, remaining: 0 });
  });

  it("rejects invalid quota bounds at construction", () => {
    const baseline = {
      globalDailyQuota: 10,
      globalSafetyReserve: 2,
      perUserDailyQuota: 5,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    };

    expect(() =>
      createInMemoryQuota({ ...baseline, globalDailyQuota: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      createInMemoryQuota({ ...baseline, globalSafetyReserve: 11 }),
    ).toThrow(RangeError);
    expect(() =>
      createInMemoryQuota({ ...baseline, perUserDailyQuota: 9 }),
    ).toThrow(RangeError);
    expect(() =>
      createInMemoryQuota({
        ...baseline,
        globalDailyQuota: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow(RangeError);
  });

  it("does not oversubscribe simultaneous reservations", async () => {
    const quota = createInMemoryQuota({
      globalDailyQuota: 7,
      globalSafetyReserve: 2,
      perUserDailyQuota: 5,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        quota.reserve({
          subject: `subject-${String(index)}`,
          operation: "player",
          cost: 1,
        }),
      ),
    );

    expect(results.filter((result) => result.reserved)).toHaveLength(5);
    expect(
      results.filter(
        (result) => !result.reserved && result.reason === "global_reserve",
      ),
    ).toHaveLength(15);
  });

  it("rolls back an unused reservation exactly once", async () => {
    const quota = createInMemoryQuota({
      globalDailyQuota: 5,
      globalSafetyReserve: 0,
      perUserDailyQuota: 5,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });
    const reservation = await quota.reserve({
      subject: "first",
      operation: "player",
      cost: 5,
    });
    if (!reservation.reserved) throw new Error("Expected reservation");

    reservation.rollback();
    reservation.rollback();

    await expect(
      quota.reserve({ subject: "second", operation: "player", cost: 5 }),
    ).resolves.toMatchObject({ reserved: true, remaining: 0 });
  });

  it("preserves other same-subject usage while rolling back", async () => {
    const quota = createInMemoryQuota({
      globalDailyQuota: 5,
      globalSafetyReserve: 0,
      perUserDailyQuota: 5,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });
    const first = await quota.reserve({
      subject: "same",
      operation: "player",
      cost: 1,
    });
    await quota.reserve({ subject: "same", operation: "library", cost: 1 });
    if (!first.reserved) throw new Error("Expected reservation");

    first.rollback();

    await expect(
      quota.reserve({ subject: "same", operation: "game", cost: 4 }),
    ).resolves.toMatchObject({ reserved: true, remaining: 0 });
  });

  it("does not apply an old rollback to a new UTC day", async () => {
    let now = new Date("2026-07-22T23:59:59.999Z");
    const quota = createInMemoryQuota({
      globalDailyQuota: 1,
      globalSafetyReserve: 0,
      perUserDailyQuota: 1,
      now: () => now,
    });
    const oldReservation = await quota.reserve({
      subject: "old",
      operation: "player",
      cost: 1,
    });
    if (!oldReservation.reserved) throw new Error("Expected reservation");
    now = new Date("2026-07-23T00:00:00.000Z");
    await quota.reserve({ subject: "new", operation: "player", cost: 1 });

    oldReservation.rollback();

    await expect(
      quota.reserve({ subject: "third", operation: "player", cost: 1 }),
    ).resolves.toEqual({ reserved: false, reason: "global_reserve" });
  });

  it("fails closed when the UTC clock moves backward or becomes unavailable", async () => {
    let readNow = () => new Date("2026-07-22T12:00:00.000Z");
    const quota = createInMemoryQuota({
      globalDailyQuota: 5,
      globalSafetyReserve: 0,
      perUserDailyQuota: 5,
      now: () => readNow(),
    });
    await quota.reserve({ subject: "first", operation: "player", cost: 1 });

    readNow = () => new Date("2026-07-21T12:00:00.000Z");
    await expect(
      quota.reserve({ subject: "second", operation: "player", cost: 1 }),
    ).resolves.toEqual({ reserved: false, reason: "unavailable" });

    readNow = () => {
      throw new Error("synthetic clock failure");
    };
    await expect(
      quota.reserve({ subject: "second", operation: "player", cost: 1 }),
    ).resolves.toEqual({ reserved: false, reason: "unavailable" });
  });

  it("documents that a new process-local instance starts with fresh state", async () => {
    const options = {
      globalDailyQuota: 1,
      globalSafetyReserve: 0,
      perUserDailyQuota: 1,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    };
    const first = createInMemoryQuota(options);
    await first.reserve({ subject: "same", operation: "player", cost: 1 });

    const restarted = createInMemoryQuota(options);

    await expect(
      restarted.reserve({ subject: "same", operation: "player", cost: 1 }),
    ).resolves.toMatchObject({ reserved: true, remaining: 0 });
  });
});
