import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import type { QuotaPort } from "../application/ports/quota.js";

interface InMemoryQuotaOptions {
  readonly globalDailyQuota: number;
  readonly globalSafetyReserve: number;
  readonly perUserDailyQuota: number;
  readonly now: () => Date;
}

export function deriveQuotaSubjectKey(subject: string): string {
  return createHash("sha256").update(subject, "utf8").digest("hex");
}

export function createInMemoryQuota(options: InMemoryQuotaOptions): QuotaPort {
  if (
    !Number.isSafeInteger(options.globalDailyQuota) ||
    options.globalDailyQuota <= 0 ||
    !Number.isSafeInteger(options.globalSafetyReserve) ||
    options.globalSafetyReserve < 0 ||
    !Number.isSafeInteger(options.perUserDailyQuota) ||
    options.perUserDailyQuota <= 0 ||
    options.globalSafetyReserve > options.globalDailyQuota ||
    options.perUserDailyQuota >
      options.globalDailyQuota - options.globalSafetyReserve
  ) {
    throw new RangeError("Invalid in-memory quota bounds");
  }

  let utcDay: string | undefined;
  let globalUsed = 0;
  // Only successful positive-cost reservations are inserted, so the map size
  // cannot exceed the usable global daily quota and is cleared at rollover.
  const subjectUsage = new Map<string, number>();

  return {
    reserve(request) {
      if (request.subject.trim().length === 0) {
        return Promise.reject(new RangeError("Quota subject is required"));
      }
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
        globalUsed = 0;
        subjectUsage.clear();
      }

      const subjectKey = deriveQuotaSubjectKey(request.subject);
      const currentUserUsed = subjectUsage.get(subjectKey) ?? 0;
      const userUsed = currentUserUsed + request.cost;
      if (userUsed > options.perUserDailyQuota) {
        return Promise.resolve({
          reserved: false,
          reason: "user_exhausted",
        });
      }

      const usableGlobalQuota =
        options.globalDailyQuota - options.globalSafetyReserve;
      if (globalUsed + request.cost > usableGlobalQuota) {
        return Promise.resolve({
          reserved: false,
          reason: "global_reserve",
        });
      }

      // Keep checks and both writes synchronous: one event-loop turn is the
      // atomicity boundary promised by this single-instance adapter.
      globalUsed += request.cost;
      subjectUsage.set(subjectKey, userUsed);
      let rolledBack = false;

      return Promise.resolve({
        reserved: true,
        remaining: options.perUserDailyQuota - userUsed,
        rollback() {
          if (rolledBack) return;
          rolledBack = true;
          if (utcDay !== requestUtcDay) return;
          // Same-day reservations are the only writers for this key, and each
          // closure rolls back at most once, so usage is present here.
          const currentUsage = subjectUsage.get(subjectKey);
          assert(currentUsage !== undefined);
          globalUsed -= request.cost;
          const nextUsage = currentUsage - request.cost;
          if (nextUsage === 0) subjectUsage.delete(subjectKey);
          else subjectUsage.set(subjectKey, nextUsage);
        },
      });
    },
  };
}
