export interface ServicePolicy {
  readonly upstreamTimeoutMs: number;
  readonly maxRetryAttempts: number;
  readonly globalDailyQuota: number;
  readonly globalSafetyReserve: number;
  readonly perUserDailyQuota: number;
  readonly cacheTtlSeconds: number;
  readonly maxHostConcurrency: number;
  readonly maxOperationConcurrency: number;
  readonly maxToolFanOut: number;
  readonly defaultPageSize: number;
  readonly maxPageSize: number;
  readonly executionDeadlineMs: number;
  readonly maxOutputBytes: number;
}

export const BASELINE_SERVICE_POLICY: ServicePolicy = Object.freeze({
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

const POSITIVE_POLICY_FIELDS = [
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
] as const satisfies readonly (keyof ServicePolicy)[];

const NON_NEGATIVE_POLICY_FIELDS = [
  "maxRetryAttempts",
  "globalSafetyReserve",
  "cacheTtlSeconds",
] as const satisfies readonly (keyof ServicePolicy)[];

const POLICY_MAXIMA = [
  ["upstreamTimeoutMs", 60_000],
  ["maxRetryAttempts", 5],
  ["globalDailyQuota", 100_000],
  ["perUserDailyQuota", 10_000],
  ["cacheTtlSeconds", 86_400],
  ["maxHostConcurrency", 64],
  ["maxOperationConcurrency", 32],
  ["maxToolFanOut", 100],
  ["maxPageSize", 200],
  ["executionDeadlineMs", 120_000],
  ["maxOutputBytes", 1_048_576],
] as const satisfies readonly (readonly [keyof ServicePolicy, number])[];

export function createServicePolicy(
  overrides: Partial<ServicePolicy> = {},
): ServicePolicy {
  const policy: ServicePolicy = { ...BASELINE_SERVICE_POLICY, ...overrides };

  for (const field of POSITIVE_POLICY_FIELDS) {
    if (!Number.isInteger(policy[field]) || policy[field] <= 0) {
      throw new RangeError(`${field} must be a positive integer`);
    }
  }

  for (const field of NON_NEGATIVE_POLICY_FIELDS) {
    if (!Number.isInteger(policy[field]) || policy[field] < 0) {
      throw new RangeError(`${field} must be a non-negative integer`);
    }
  }

  for (const [field, maximum] of POLICY_MAXIMA) {
    if (policy[field] > maximum) {
      throw new RangeError(`${field} exceeds its operational ceiling`);
    }
  }

  if (policy.globalSafetyReserve > policy.globalDailyQuota) {
    throw new RangeError("globalSafetyReserve exceeds globalDailyQuota");
  }

  if (
    policy.perUserDailyQuota >
    policy.globalDailyQuota - policy.globalSafetyReserve
  ) {
    throw new RangeError("perUserDailyQuota exceeds usable global quota");
  }

  if (policy.defaultPageSize > policy.maxPageSize) {
    throw new RangeError("defaultPageSize exceeds maxPageSize");
  }

  if (policy.maxOperationConcurrency > policy.maxHostConcurrency) {
    throw new RangeError("maxOperationConcurrency exceeds maxHostConcurrency");
  }

  if (policy.upstreamTimeoutMs > policy.executionDeadlineMs) {
    throw new RangeError("upstreamTimeoutMs exceeds executionDeadlineMs");
  }

  return Object.freeze(policy);
}
