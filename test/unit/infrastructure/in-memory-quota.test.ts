import { describe, expect, it } from "vitest";

import { createInMemoryQuota } from "../../../src/infrastructure/in-memory-quota.js";

const fixedNow = () => new Date("2026-07-22T12:00:00.000Z");

describe("in-memory instance quota", () => {
  it("reserves instance quota without a caller identity", async () => {
    const quota = createInMemoryQuota({
      globalDailyQuota: 10,
      globalSafetyReserve: 2,
      now: fixedNow,
    });

    await expect(
      quota.reserve({ operation: "player", cost: 2 }),
    ).resolves.toMatchObject({ reserved: true, remaining: 6 });
  });

  it("preserves the configured global safety reserve", async () => {
    const quota = createInMemoryQuota({
      globalDailyQuota: 10,
      globalSafetyReserve: 3,
      now: fixedNow,
    });

    await quota.reserve({ operation: "game", cost: 5 });
    await expect(
      quota.reserve({ operation: "game", cost: 3 }),
    ).resolves.toEqual({ reserved: false, reason: "global_reserve" });
    await expect(
      quota.reserve({ operation: "game", cost: 2 }),
    ).resolves.toMatchObject({ reserved: true, remaining: 0 });
  });

  it("resets the instance counter at the next UTC day", async () => {
    let now = new Date("2026-07-22T23:59:59.999Z");
    const quota = createInMemoryQuota({
      globalDailyQuota: 5,
      globalSafetyReserve: 0,
      now: () => now,
    });

    await quota.reserve({ operation: "player", cost: 5 });
    now = new Date("2026-07-23T00:00:00.000Z");

    await expect(
      quota.reserve({ operation: "player", cost: 5 }),
    ).resolves.toMatchObject({ reserved: true, remaining: 0 });
  });

  it("rejects malformed requests before mutating quota state", async () => {
    const quota = createInMemoryQuota({
      globalDailyQuota: 5,
      globalSafetyReserve: 0,
      now: fixedNow,
    });
    const malformed = [
      { operation: "", cost: 1 },
      { operation: "player", cost: 0 },
      { operation: "player", cost: 1.5 },
      { operation: "player", cost: Number.NaN },
      { operation: "player", cost: Number.POSITIVE_INFINITY },
      { operation: "player", cost: Number.MAX_SAFE_INTEGER + 1 },
    ];

    for (const request of malformed) {
      await expect(quota.reserve(request)).rejects.toBeInstanceOf(RangeError);
    }
    await expect(
      quota.reserve({ operation: "player", cost: 5 }),
    ).resolves.toMatchObject({ reserved: true, remaining: 0 });
  });

  it("rejects invalid quota bounds at construction", () => {
    const baseline = {
      globalDailyQuota: 10,
      globalSafetyReserve: 2,
      now: fixedNow,
    };

    expect(() =>
      createInMemoryQuota({ ...baseline, globalDailyQuota: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      createInMemoryQuota({ ...baseline, globalSafetyReserve: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      createInMemoryQuota({ ...baseline, globalSafetyReserve: 11 }),
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
      now: fixedNow,
    });

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        quota.reserve({ operation: "player", cost: 1 }),
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
      now: fixedNow,
    });
    const reservation = await quota.reserve({ operation: "player", cost: 5 });
    if (!reservation.reserved) throw new Error("Expected reservation");

    reservation.rollback();
    reservation.rollback();

    await expect(
      quota.reserve({ operation: "player", cost: 5 }),
    ).resolves.toMatchObject({ reserved: true, remaining: 0 });
  });

  it("preserves other usage while rolling back one reservation", async () => {
    const quota = createInMemoryQuota({
      globalDailyQuota: 5,
      globalSafetyReserve: 0,
      now: fixedNow,
    });
    const first = await quota.reserve({ operation: "player", cost: 1 });
    await quota.reserve({ operation: "library", cost: 1 });
    if (!first.reserved) throw new Error("Expected reservation");

    first.rollback();

    await expect(
      quota.reserve({ operation: "game", cost: 4 }),
    ).resolves.toMatchObject({ reserved: true, remaining: 0 });
  });

  it("does not apply an old rollback to a new UTC day", async () => {
    let now = new Date("2026-07-22T23:59:59.999Z");
    const quota = createInMemoryQuota({
      globalDailyQuota: 1,
      globalSafetyReserve: 0,
      now: () => now,
    });
    const oldReservation = await quota.reserve({
      operation: "player",
      cost: 1,
    });
    if (!oldReservation.reserved) throw new Error("Expected reservation");
    now = new Date("2026-07-23T00:00:00.000Z");
    await quota.reserve({ operation: "player", cost: 1 });

    oldReservation.rollback();

    await expect(
      quota.reserve({ operation: "player", cost: 1 }),
    ).resolves.toEqual({ reserved: false, reason: "global_reserve" });
  });

  it("fails closed when the UTC clock moves backward or is unavailable", async () => {
    let readNow = fixedNow;
    const quota = createInMemoryQuota({
      globalDailyQuota: 5,
      globalSafetyReserve: 0,
      now: () => readNow(),
    });
    await quota.reserve({ operation: "player", cost: 1 });

    readNow = () => new Date("2026-07-21T12:00:00.000Z");
    await expect(
      quota.reserve({ operation: "player", cost: 1 }),
    ).resolves.toEqual({ reserved: false, reason: "unavailable" });

    readNow = () => {
      throw new Error("synthetic clock failure");
    };
    await expect(
      quota.reserve({ operation: "player", cost: 1 }),
    ).resolves.toEqual({ reserved: false, reason: "unavailable" });
  });

  it("documents that a restarted process starts with fresh state", async () => {
    const options = {
      globalDailyQuota: 1,
      globalSafetyReserve: 0,
      now: fixedNow,
    };
    const first = createInMemoryQuota(options);
    await first.reserve({ operation: "player", cost: 1 });

    const restarted = createInMemoryQuota(options);

    await expect(
      restarted.reserve({ operation: "player", cost: 1 }),
    ).resolves.toMatchObject({ reserved: true, remaining: 0 });
  });
});
