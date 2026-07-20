import type { ErrorCode } from "../domain/result.js";

export class OptionalSourceDisabledError extends Error {
  readonly code: ErrorCode = "UPSTREAM_UNAVAILABLE";
  readonly retryable = false;

  constructor() {
    super("An optional Steam source is disabled");
  }
}
