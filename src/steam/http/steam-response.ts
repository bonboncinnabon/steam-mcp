import type { z } from "zod";

import type { ErrorCode } from "../../domain/result.js";

type SteamResponseFailureKind =
  "invalid_encoding" | "invalid_json" | "invalid_shape";

export class SteamResponseValidationError extends Error {
  readonly code: ErrorCode = "UPSTREAM_UNAVAILABLE";
  readonly retryable = false;
  readonly kind: SteamResponseFailureKind;

  constructor(kind: SteamResponseFailureKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export function parseSteamResponse<T>(
  body: Uint8Array,
  schema: z.ZodType<T>,
): T {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new SteamResponseValidationError(
      "invalid_encoding",
      "Steam returned invalid text encoding",
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new SteamResponseValidationError(
      "invalid_json",
      "Steam returned malformed JSON",
    );
  }
  const result = schema.safeParse(decoded);
  if (!result.success) {
    throw new SteamResponseValidationError(
      "invalid_shape",
      "Steam response did not match its supported contract",
    );
  }
  return result.data;
}
