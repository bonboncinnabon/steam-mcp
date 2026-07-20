import { readdir, readFile } from "node:fs/promises";

import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import { parseSteamId64 } from "../../../src/domain/steam-id.js";
import { createSteamLibraryAdapter } from "../../../src/steam/adapters/steam-library-adapter.js";
import { executeSteamRequest } from "../../../src/steam/http/steam-http-client.js";
import { buildSteamRequest } from "../../../src/steam/http/steam-request.js";
import { parseSteamResponse } from "../../../src/steam/http/steam-response.js";

const storeDetailsSchema = z.record(
  z.string(),
  z.object({
    success: z.literal(true),
    data: z.object({
      steam_appid: z.number().int().positive(),
      name: z.string().min(1),
      type: z.string().min(1),
    }),
  }),
);

describe("scrubbed Steam HTTP fixtures", () => {
  it("contains no credential fields, headers, URLs, or SteamID64 values", async () => {
    const fixtureDirectory = new URL(
      "../../fixtures/steam/http/",
      import.meta.url,
    );
    const fixtureNames = (await readdir(fixtureDirectory)).filter((name) =>
      /\.(?:json|txt)$/.test(name),
    );

    for (const fixtureName of fixtureNames) {
      const fixture = await readFile(
        new URL(fixtureName, fixtureDirectory),
        "utf8",
      );
      expect(fixture).not.toMatch(
        /(?:7656119\d{10}|[?&]key=|authorization|set-cookie|https?:\/\/)/i,
      );
    }
  });

  it("executes and validates a successful store-details fixture", async () => {
    const body = await readFile(
      new URL(
        "../../fixtures/steam/http/store-details.success.json",
        import.meta.url,
      ),
    );
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body, { status: 200 }));

    const response = await executeSteamRequest(
      buildSteamRequest("storeDetails", { appids: "620" }),
      { fetchImpl, deadlineMs: 1_000, maxResponseBytes: 10_000 },
    );

    expect(parseSteamResponse(response.body, storeDetailsSchema)).toMatchObject(
      {
        "620": { data: { name: "Portal 2", steam_appid: 620 } },
      },
    );
  });

  it("validates the documented private-library response without inventing games", async () => {
    const body = await readFile(
      new URL(
        "../../fixtures/steam/http/owned-games.private.json",
        import.meta.url,
      ),
    );
    const adapter = createSteamLibraryAdapter({
      apiKey: "synthetic-api-key",
      execute: vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        body,
        finalUrl:
          "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/",
      }),
    });

    await expect(
      adapter.getOwnedGames(
        parseSteamId64("76561198000000000"),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ visibility: "private", items: [] });
  });

  it("preserves an explicit empty player list", async () => {
    const body = await readFile(
      new URL(
        "../../fixtures/steam/http/player-summaries.empty.json",
        import.meta.url,
      ),
    );
    const schema = z.object({
      response: z.object({ players: z.array(z.unknown()) }),
    });

    expect(parseSteamResponse(body, schema)).toEqual({
      response: { players: [] },
    });
  });

  it("rejects a scrubbed malformed-body fixture without exposing it", async () => {
    const body = await readFile(
      new URL(
        "../../fixtures/steam/http/malformed-response.txt",
        import.meta.url,
      ),
    );

    expect(() => parseSteamResponse(body, storeDetailsSchema)).toThrow(
      "Steam returned malformed JSON",
    );
  });

  it("revalidates a fixture response reached through a Steam redirect", async () => {
    const body = await readFile(
      new URL(
        "../../fixtures/steam/http/store-details.success.json",
        import.meta.url,
      ),
    );
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/api/appdetails?appids=620&cc=US" },
        }),
      )
      .mockResolvedValueOnce(new Response(body, { status: 200 }));

    const response = await executeSteamRequest(
      buildSteamRequest("storeDetails", { appids: "620" }),
      { fetchImpl, deadlineMs: 1_000, maxResponseBytes: 10_000 },
    );

    expect(
      parseSteamResponse(response.body, storeDetailsSchema),
    ).toHaveProperty("620.data.name", "Portal 2");
  });

  it("recovers the fixture after bounded 429 and selected 5xx failures", async () => {
    const body = await readFile(
      new URL(
        "../../fixtures/steam/http/store-details.success.json",
        import.meta.url,
      ),
    );

    for (const failure of [
      new Response(null, {
        status: 429,
        headers: { "retry-after": "0" },
      }),
      new Response(null, { status: 503 }),
    ]) {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(failure)
        .mockResolvedValueOnce(new Response(body, { status: 200 }));

      const response = await executeSteamRequest(
        buildSteamRequest("storeDetails", { appids: "620" }),
        {
          fetchImpl,
          deadlineMs: 1_000,
          maxResponseBytes: 10_000,
          maxRetryAttempts: 1,
          random: () => 0,
          sleep: () => Promise.resolve(),
        },
      );

      expect(
        parseSteamResponse(response.body, storeDetailsSchema),
      ).toHaveProperty("620.data.steam_appid", 620);
    }
  });

  it("terminates the fixture request at its execution deadline", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(
      async (_url, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(new Error("fixture request aborted"));
            },
            { once: true },
          );
        }),
    );

    try {
      const execution = executeSteamRequest(
        buildSteamRequest("storeDetails", { appids: "620" }),
        { fetchImpl, deadlineMs: 10, maxResponseBytes: 10_000 },
      );
      const rejection = expect(execution).rejects.toThrow(
        "Steam request deadline exceeded",
      );
      await vi.advanceTimersByTimeAsync(10);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates fixture-request cancellation without exposing its reason", async () => {
    const controller = new AbortController();
    controller.abort(new Error("synthetic-private-cancel-reason"));
    const fetchImpl = vi.fn<typeof fetch>((_url, init) =>
      Promise.reject(
        init?.signal?.aborted === true
          ? new Error("fixture request aborted")
          : new Error("cancellation was not propagated"),
      ),
    );

    const execution = executeSteamRequest(
      buildSteamRequest("storeDetails", { appids: "620" }),
      {
        fetchImpl,
        deadlineMs: 1_000,
        maxResponseBytes: 10_000,
        signal: controller.signal,
      },
    );

    await expect(execution).rejects.toThrow("Steam request cancelled");
    await expect(execution).rejects.not.toThrow(
      "synthetic-private-cancel-reason",
    );
  });

  it("maps fixture credential rejection without retrying", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }));

    await expect(
      executeSteamRequest(
        buildSteamRequest("storeDetails", { appids: "620" }),
        {
          fetchImpl,
          deadlineMs: 1_000,
          maxResponseBytes: 10_000,
          maxRetryAttempts: 2,
        },
      ),
    ).rejects.toMatchObject({
      code: "STEAM_AUTH_FAILED",
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
