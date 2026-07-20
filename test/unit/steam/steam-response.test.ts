import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  BestEffortSourceChangedError,
  parseBestEffortResponse,
} from "../../../src/steam/best-effort/best-effort-response.js";
import {
  parseSteamResponse,
  SteamResponseValidationError,
} from "../../../src/steam/http/steam-response.js";

describe("parseSteamResponse", () => {
  it("validates and returns a supported JSON response", () => {
    const body = new TextEncoder().encode('{"name":"Portal 2"}');

    expect(parseSteamResponse(body, z.object({ name: z.string() }))).toEqual({
      name: "Portal 2",
    });
  });

  it("replaces malformed JSON and its raw body with a sanitized error", () => {
    const body = new TextEncoder().encode('{"key":"synthetic-secret"');

    expect(() =>
      parseSteamResponse(body, z.object({ name: z.string() })),
    ).toThrow(
      expect.objectContaining({
        code: "UPSTREAM_UNAVAILABLE",
        kind: "invalid_json",
        message: "Steam returned malformed JSON",
        retryable: false,
      }),
    );

    try {
      parseSteamResponse(body, z.object({ name: z.string() }));
    } catch (error) {
      expect(error).toBeInstanceOf(SteamResponseValidationError);
      expect(JSON.stringify(error)).not.toContain("synthetic-secret");
      expect(error).not.toHaveProperty("cause");
    }
  });

  it("rejects invalid UTF-8 with a sanitized encoding error", () => {
    expect(() =>
      parseSteamResponse(
        new Uint8Array([0xc3, 0x28]),
        z.object({ name: z.string() }),
      ),
    ).toThrow(
      expect.objectContaining({
        kind: "invalid_encoding",
        message: "Steam returned invalid text encoding",
      }),
    );
  });

  it("replaces invalid response shapes with a sanitized schema error", () => {
    const body = new TextEncoder().encode(
      '{"name":{"credential":"synthetic-secret"}}',
    );

    try {
      parseSteamResponse(body, z.object({ name: z.string() }));
      expect.unreachable("expected response validation to fail");
    } catch (error) {
      expect(error).toMatchObject({
        kind: "invalid_shape",
        message: "Steam response did not match its supported contract",
      });
      expect(JSON.stringify(error)).not.toContain("synthetic-secret");
      expect(error).not.toHaveProperty("cause");
    }
  });

  it("returns the normalized output of a transforming schema", () => {
    const body = new TextEncoder().encode('{"appid":"620"}');
    const schema = z
      .object({ appid: z.string().regex(/^\d+$/) })
      .transform(({ appid }) => ({ appId: Number(appid) }));

    expect(parseSteamResponse(body, schema)).toEqual({ appId: 620 });
  });
});

describe("parseBestEffortResponse", () => {
  it("maps upstream contract validation to the best-effort drift code", () => {
    expect(() =>
      parseBestEffortResponse(
        new TextEncoder().encode('{"name":42}'),
        z.object({ name: z.string() }),
      ),
    ).toThrow(BestEffortSourceChangedError);
  });

  it("does not hide an unexpected programmer error", () => {
    const programmerError = new Error("Synthetic schema bug");
    const schema = z.unknown().transform(() => {
      throw programmerError;
    });

    expect(() =>
      parseBestEffortResponse(new TextEncoder().encode("{}"), schema),
    ).toThrow(programmerError);
  });
});
