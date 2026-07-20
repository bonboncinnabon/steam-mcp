import type { z } from "zod";

import {
  parsePaginationCursor,
  type PaginationCursor,
} from "../../domain/pagination-cursor.js";

export function encodeOpaqueCursor(payload: unknown): PaginationCursor {
  return parsePaginationCursor(
    Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"),
  );
}

export function decodeOpaqueCursor<T>(cursor: string, schema: z.ZodType<T>): T {
  const parsedCursor = parsePaginationCursor(cursor);
  try {
    const bytes = Buffer.from(parsedCursor, "base64url");
    if (bytes.toString("base64url") !== parsedCursor) {
      throw new TypeError("Invalid opaque cursor");
    }
    return schema.parse(JSON.parse(bytes.toString("utf8")));
  } catch {
    throw new TypeError("Invalid opaque cursor");
  }
}
