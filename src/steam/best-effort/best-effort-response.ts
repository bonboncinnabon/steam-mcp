import type { z } from "zod";

import type { ErrorCode } from "../../domain/result.js";
import {
  parseSteamResponse,
  SteamResponseValidationError,
} from "../http/steam-response.js";

export class BestEffortSourceChangedError extends Error {
  readonly code: ErrorCode = "BEST_EFFORT_SOURCE_CHANGED";
  readonly retryable = false;

  constructor() {
    super("A best-effort Steam source changed its response contract");
  }
}

export function parseBestEffortResponse<T>(
  body: Uint8Array,
  schema: z.ZodType<T>,
): T {
  try {
    return parseSteamResponse(body, schema);
  } catch (error) {
    if (error instanceof SteamResponseValidationError) {
      throw new BestEffortSourceChangedError();
    }
    throw error;
  }
}
