export const SOURCE_TIERS = ["supported", "best_effort", "derived"] as const;

export type SourceTier = (typeof SOURCE_TIERS)[number];

export const ERROR_CODES = [
  "INVALID_INPUT",
  "IDENTITY_NOT_LINKED",
  "PROFILE_PRIVATE",
  "NOT_FOUND",
  "STEAM_AUTH_FAILED",
  "STEAM_RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE",
  "BEST_EFFORT_SOURCE_CHANGED",
  "SERVICE_QUOTA_EXCEEDED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

interface SuccessOptions {
  readonly partial: boolean;
  readonly warnings: readonly string[];
}

export function success<T>(
  data: T,
  sourceTiers: readonly SourceTier[],
  options: SuccessOptions = { partial: false, warnings: [] },
) {
  return {
    ok: true as const,
    data,
    meta: {
      schema_version: "1" as const,
      source_tiers: sourceTiers,
      partial: options.partial,
      warnings: options.warnings,
    },
  };
}

export function failure(code: ErrorCode, message: string, retryable: boolean) {
  return {
    ok: false as const,
    error: {
      code,
      message,
      retryable,
    },
  };
}

export type SuccessResult<T> = ReturnType<typeof success<T>>;
export type FailureResult = ReturnType<typeof failure>;
export type ToolResult<T> = SuccessResult<T> | FailureResult;

export function renderResult<T>(
  result: ToolResult<T>,
  renderSuccess: (result: SuccessResult<T>) => string,
): string {
  if (!result.ok) {
    return result.error.message;
  }

  return renderSuccess(result);
}
