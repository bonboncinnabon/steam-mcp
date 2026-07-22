import type { QuotaPort } from "../application/ports/quota.js";

interface InMemoryQuotaOptions {
  readonly globalDailyQuota: number;
  readonly globalSafetyReserve: number;
  readonly now: () => Date;
}

export function createInMemoryQuota(options: InMemoryQuotaOptions): QuotaPort {
  if (
    !Number.isSafeInteger(options.globalDailyQuota) ||
    options.globalDailyQuota <= 0 ||
    !Number.isSafeInteger(options.globalSafetyReserve) ||
    options.globalSafetyReserve < 0 ||
    options.globalSafetyReserve > options.globalDailyQuota
  ) {
    throw new RangeError("Invalid in-memory quota bounds");
  }

  const usableDailyQuota =
    options.globalDailyQuota - options.globalSafetyReserve;
  let utcDay: string | undefined;
  let used = 0;

  return {
    reserve(request) {
      if (request.operation.trim().length === 0) {
        return Promise.reject(new RangeError("Quota operation is required"));
      }
      if (!Number.isSafeInteger(request.cost) || request.cost <= 0) {
        return Promise.reject(
          new RangeError("Quota cost must be a positive integer"),
        );
      }

      let requestUtcDay: string;
      try {
        requestUtcDay = options.now().toISOString().slice(0, 10);
      } catch {
        return Promise.resolve({ reserved: false, reason: "unavailable" });
      }
      if (utcDay !== undefined && requestUtcDay < utcDay) {
        return Promise.resolve({ reserved: false, reason: "unavailable" });
      }
      if (requestUtcDay !== utcDay) {
        utcDay = requestUtcDay;
        used = 0;
      }

      if (used + request.cost > usableDailyQuota) {
        return Promise.resolve({ reserved: false, reason: "global_reserve" });
      }

      used += request.cost;
      let rolledBack = false;

      return Promise.resolve({
        reserved: true,
        remaining: usableDailyQuota - used,
        rollback() {
          if (rolledBack) return;
          rolledBack = true;
          if (utcDay === requestUtcDay) used -= request.cost;
        },
      });
    },
  };
}
