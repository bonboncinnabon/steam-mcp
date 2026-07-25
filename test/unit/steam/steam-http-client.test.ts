import { describe, expect, it, vi } from "vitest";

import { executeSteamRequest } from "../../../src/steam/http/steam-http-client.js";
import { buildSteamRequest } from "../../../src/steam/http/steam-request.js";

describe("executeSteamRequest", () => {
  it("uses the platform fetch implementation by default", async () => {
    const platformFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", platformFetch);

    try {
      await executeSteamRequest(
        buildSteamRequest("storeDetails", { appids: "570" }),
        { deadlineMs: 1_000, maxResponseBytes: 1_024 },
      );
      expect(platformFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("excludes credential-bearing query parameters from the returned final URL", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 200 }));

    const response = await executeSteamRequest(
      buildSteamRequest("resolveVanityUrl", {
        key: "synthetic-secret",
        vanityurl: "portal_fan",
      }),
      { fetchImpl, deadlineMs: 1_000, maxResponseBytes: 1_024 },
    );

    expect(response.finalUrl).toBe(
      "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/",
    );
    expect(response.finalUrl).not.toContain("synthetic-secret");
  });

  it("follows an allowlisted redirect after revalidating its target", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/api/appdetails?appids=570&cc=US" },
        }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await executeSteamRequest(
      buildSteamRequest("storeDetails", { appids: "570" }),
      {
        fetchImpl,
        deadlineMs: 1_000,
        maxResponseBytes: 1_024,
      },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      "https://store.steampowered.com/api/appdetails?appids=570&cc=US",
    );
  });

  it("rejects a redirect response without a location", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 302 }));

    await expect(
      executeSteamRequest(
        buildSteamRequest("storeDetails", { appids: "570" }),
        {
          fetchImpl,
          deadlineMs: 1_000,
          maxResponseBytes: 1_024,
        },
      ),
    ).rejects.toThrow("Blocked Steam redirect");
  });

  it("rejects a redirect chain after its bounded hop limit", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "/next" },
      }),
    );

    await expect(
      executeSteamRequest(
        buildSteamRequest("storeDetails", { appids: "570" }),
        {
          fetchImpl,
          deadlineMs: 1_000,
          maxResponseBytes: 1_024,
        },
      ),
    ).rejects.toThrow("Blocked Steam redirect");
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("rejects a response whose declared size exceeds the configured limit", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("12345", {
        status: 200,
        headers: { "content-length": "5" },
      }),
    );

    await expect(
      executeSteamRequest(
        buildSteamRequest("storeDetails", { appids: "570" }),
        {
          fetchImpl,
          deadlineMs: 1_000,
          maxResponseBytes: 4,
        },
      ),
    ).rejects.toThrow("Steam response exceeded size limit");
  });

  it("stops reading an undeclared response when its bytes exceed the limit", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("12345", { status: 200 }));

    await expect(
      executeSteamRequest(
        buildSteamRequest("storeDetails", { appids: "570" }),
        {
          fetchImpl,
          deadlineMs: 1_000,
          maxResponseBytes: 4,
        },
      ),
    ).rejects.toThrow("Steam response exceeded size limit");
  });

  it("normalizes a bodyless response to an empty byte array", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));

    const response = await executeSteamRequest(
      buildSteamRequest("storeDetails", { appids: "570" }),
      { fetchImpl, deadlineMs: 1_000, maxResponseBytes: 1_024 },
    );

    expect(response.body).toEqual(new Uint8Array());
  });

  it("aborts upstream work when the request deadline expires", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.signal === undefined || init.signal === null) {
        throw new Error("missing deadline signal");
      }

      return await new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => {
            reject(new Error("fetch aborted"));
          },
          { once: true },
        );
      });
    });

    try {
      const execution = executeSteamRequest(
        buildSteamRequest("storeDetails", { appids: "570" }),
        { fetchImpl, deadlineMs: 10, maxResponseBytes: 1_024 },
      );
      const rejection = expect(execution).rejects.toMatchObject({
        code: "UPSTREAM_UNAVAILABLE",
        retryable: true,
      });
      await vi.advanceTimersByTimeAsync(10);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates caller cancellation as a sanitized cancellation failure", async () => {
    const controller = new AbortController();
    controller.abort(new Error("caller secret must not escape"));
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      if (init?.signal?.aborted !== true) {
        return Promise.reject(new Error("caller cancellation not propagated"));
      }
      return Promise.reject(new Error("fetch aborted"));
    });

    await expect(
      executeSteamRequest(
        buildSteamRequest("storeDetails", { appids: "570" }),
        {
          fetchImpl,
          deadlineMs: 1_000,
          maxResponseBytes: 1_024,
          signal: controller.signal,
        },
      ),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
    });
  });

  it("replaces credential-bearing network failures with a sanitized error", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new Error(
          "connect failed: https://api.steampowered.com/path?key=synthetic-secret",
        ),
      );

    const execution = executeSteamRequest(
      buildSteamRequest("storeDetails", { appids: "570" }),
      { fetchImpl, deadlineMs: 1_000, maxResponseBytes: 1_024 },
    );

    await expect(execution).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: false,
    });
    await expect(execution).rejects.not.toThrow("synthetic-secret");
  });

  it("retries a selected server failure within the configured attempt budget", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const sleep = vi
      .fn<(delayMs: number, signal: AbortSignal) => Promise<void>>()
      .mockResolvedValue(undefined);

    const response = await executeSteamRequest(
      buildSteamRequest("storeDetails", { appids: "570" }),
      {
        fetchImpl,
        deadlineMs: 1_000,
        maxResponseBytes: 1_024,
        maxRetryAttempts: 1,
        retryBaseDelayMs: 100,
        retryMaxDelayMs: 1_000,
        random: () => 0.5,
        sleep,
      },
    );

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(50, expect.any(AbortSignal));
  });

  it("retries an allowlisted transient network failure", async () => {
    const transientError = Object.assign(new Error("socket timed out"), {
      code: "ETIMEDOUT",
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const sleep = vi
      .fn<(delayMs: number, signal: AbortSignal) => Promise<void>>()
      .mockResolvedValue(undefined);

    const response = await executeSteamRequest(
      buildSteamRequest("storeDetails", { appids: "570" }),
      {
        fetchImpl,
        deadlineMs: 1_000,
        maxResponseBytes: 1_024,
        maxRetryAttempts: 1,
        random: () => 0,
        sleep,
      },
    );

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns a typed unavailable error when transient network retries exhaust", async () => {
    const transientError = Object.assign(new Error("socket timed out"), {
      code: "ETIMEDOUT",
    });
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(transientError);
    const sleep = vi
      .fn<(delayMs: number, signal: AbortSignal) => Promise<void>>()
      .mockResolvedValue(undefined);

    await expect(
      executeSteamRequest(
        buildSteamRequest("storeDetails", { appids: "570" }),
        {
          fetchImpl,
          deadlineMs: 1_000,
          maxResponseBytes: 1_024,
          maxRetryAttempts: 1,
          random: () => 0,
          sleep,
        },
      ),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns a typed authentication failure without retrying", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }));

    await expect(
      executeSteamRequest(
        buildSteamRequest("storeDetails", { appids: "570" }),
        {
          fetchImpl,
          deadlineMs: 1_000,
          maxResponseBytes: 1_024,
          maxRetryAttempts: 2,
        },
      ),
    ).rejects.toMatchObject({
      code: "STEAM_AUTH_FAILED",
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("passes through a private-list 401 only for the friend-list endpoint", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }));

    await expect(
      executeSteamRequest(
        buildSteamRequest("getFriendList", {
          key: "synthetic-api-key",
          steamid: "76561198000000000",
          relationship: "friend",
        }),
        {
          fetchImpl,
          deadlineMs: 1_000,
          maxResponseBytes: 1_024,
          maxRetryAttempts: 2,
        },
      ),
    ).resolves.toMatchObject({ status: 401 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps a friend-list 403 classified as invalid credentials", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 403 }));

    await expect(
      executeSteamRequest(
        buildSteamRequest("getFriendList", {
          key: "synthetic-api-key",
          steamid: "76561198000000000",
          relationship: "friend",
        }),
        {
          fetchImpl,
          deadlineMs: 1_000,
          maxResponseBytes: 1_024,
        },
      ),
    ).rejects.toMatchObject({
      code: "STEAM_AUTH_FAILED",
      retryable: false,
    });
  });

  it("honors bounded rate-limit retry guidance", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { "retry-after": "2" },
        }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const sleep = vi
      .fn<(delayMs: number, signal: AbortSignal) => Promise<void>>()
      .mockResolvedValue(undefined);

    await executeSteamRequest(
      buildSteamRequest("storeDetails", { appids: "570" }),
      {
        fetchImpl,
        deadlineMs: 5_000,
        maxResponseBytes: 1_024,
        maxRetryAttempts: 1,
        retryMaxDelayMs: 1_000,
        random: () => 0,
        sleep,
      },
    );

    expect(sleep).toHaveBeenCalledWith(1_000, expect.any(AbortSignal));
  });

  it("preserves retry guidance on an exhausted rate-limit error", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: { "retry-after": "2" },
      }),
    );

    await expect(
      executeSteamRequest(
        buildSteamRequest("storeDetails", { appids: "570" }),
        {
          fetchImpl,
          deadlineMs: 5_000,
          maxResponseBytes: 1_024,
        },
      ),
    ).rejects.toMatchObject({
      code: "STEAM_RATE_LIMITED",
      retryable: true,
      retryAfterMs: 2_000,
    });
  });

  it("stops after the configured retry budget is exhausted", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    const sleep = vi
      .fn<(delayMs: number, signal: AbortSignal) => Promise<void>>()
      .mockResolvedValue(undefined);

    await expect(
      executeSteamRequest(
        buildSteamRequest("storeDetails", { appids: "570" }),
        {
          fetchImpl,
          deadlineMs: 5_000,
          maxResponseBytes: 1_024,
          maxRetryAttempts: 2,
          random: () => 0,
          sleep,
        },
      ),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("uses the cancel-aware platform timer for retry waits by default", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    try {
      const execution = executeSteamRequest(
        buildSteamRequest("storeDetails", { appids: "570" }),
        {
          fetchImpl,
          deadlineMs: 1_000,
          maxResponseBytes: 1_024,
          maxRetryAttempts: 1,
          retryBaseDelayMs: 10,
          random: () => 0.5,
        },
      );
      await vi.advanceTimersByTimeAsync(5);

      await expect(execution).resolves.toMatchObject({ status: 200 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels an active retry wait when the deadline expires", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));

    try {
      const execution = executeSteamRequest(
        buildSteamRequest("storeDetails", { appids: "570" }),
        {
          fetchImpl,
          deadlineMs: 10,
          maxResponseBytes: 1_024,
          maxRetryAttempts: 1,
          retryBaseDelayMs: 1_000,
          random: () => 1,
        },
      );
      const rejection = expect(execution).rejects.toMatchObject({
        code: "UPSTREAM_UNAVAILABLE",
        retryable: true,
      });
      await vi.advanceTimersByTimeAsync(10);

      await rejection;
      expect(fetchImpl).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not begin a retry wait after the deadline is already aborted", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        await new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(new Response(null, { status: 503 }));
          }, 20);
        }),
    );

    try {
      let settled = false;
      const execution = executeSteamRequest(
        buildSteamRequest("storeDetails", { appids: "570" }),
        {
          fetchImpl,
          deadlineMs: 10,
          maxResponseBytes: 1_024,
          maxRetryAttempts: 1,
          retryBaseDelayMs: 1_000,
          random: () => 1,
        },
      );
      const rejection = expect(execution).rejects.toMatchObject({
        code: "UPSTREAM_UNAVAILABLE",
        retryable: true,
      });
      void execution.catch(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(20);

      expect(settled).toBe(true);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
