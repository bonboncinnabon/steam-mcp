import { describe, expect, it, vi } from "vitest";

import type { AccessTokenValidator } from "../../src/infrastructure/oauth-token-validator.js";
import { createHostedApplication } from "../../src/infrastructure/hosted-runtime.js";

const baseEnvironment = {
  STEAM_API_KEY: "synthetic-hosted-key",
  OAUTH_ISSUER: "https://login.example",
  OAUTH_JWKS_URI: "https://login.example/oauth2/jwks",
  OAUTH_INTROSPECTION_URI: "https://login.example/oauth2/introspection",
  OAUTH_CLIENT_ID: "synthetic-client-id",
  OAUTH_CLIENT_SECRET: "synthetic-client-secret",
  MCP_RESOURCE_URI: "https://steam.example/mcp",
  ALLOWED_HOSTS: "steam.example",
  MAX_RETRY_ATTEMPTS: "0",
  MAX_HOST_CONCURRENCY: "1",
  MAX_OPERATION_CONCURRENCY: "1",
  MAX_CONCURRENCY_QUEUE_SIZE: "4",
} as const;

function validator(): AccessTokenValidator {
  return {
    validate: vi
      .fn<AccessTokenValidator["validate"]>()
      .mockImplementation((token) =>
        Promise.resolve({
          authorized: true,
          context: {
            subject: token,
            scopes: new Set(["steam:read"]),
          },
        }),
      ),
  };
}

function callSearch(
  app: ReturnType<typeof createHostedApplication>,
  id: number,
  token = "subject-a",
  signal?: AbortSignal,
): Promise<Response> {
  return app.handler.handle(
    new Request("https://steam.example/mcp", {
      method: "POST",
      ...(signal === undefined ? {} : { signal }),
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        host: "steam.example",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "steam_search_games",
          arguments: { query: "portal" },
        },
      }),
    }),
  );
}

function steamSearchResponse(): Response {
  return new Response(
    JSON.stringify({
      total: 1,
      items: [{ type: "app", name: "Portal", id: 400 }],
    }),
    { status: 200 },
  );
}

async function toolErrorCode(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as {
    result?: { structuredContent?: { error?: { code?: string } } };
  };
  return body.result?.structuredContent?.error?.code;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise!: (value: T) => void;
  return {
    promise: new Promise<T>((resolve) => {
      resolvePromise = resolve;
    }),
    resolve: resolvePromise,
  };
}

describe("hosted capacity integration", () => {
  it("serializes same-instance MCP races through real concurrency state", async () => {
    const gates: ReturnType<typeof deferred<Response>>[] = [];
    let active = 0;
    let maximumActive = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const gate = deferred<Response>();
      gates.push(gate);
      const response = await gate.promise;
      active -= 1;
      return response;
    });
    const app = createHostedApplication(
      { ...baseEnvironment, PER_USER_DAILY_QUOTA: "2" },
      {
        validator: validator(),
        authorizationReadiness: { isReady: vi.fn().mockResolvedValue(true) },
        fetchImpl,
      },
    );

    const first = callSearch(app, 1);
    await vi.waitFor(() => {
      expect(gates).toHaveLength(1);
    });
    const second = callSearch(app, 2);
    await Promise.resolve();
    expect(gates).toHaveLength(1);
    gates[0]?.resolve(steamSearchResponse());
    await expect(first).resolves.toMatchObject({ status: 200 });
    await vi.waitFor(() => {
      expect(gates).toHaveLength(2);
    });
    gates[1]?.resolve(steamSearchResponse());
    await expect(second).resolves.toMatchObject({ status: 200 });

    expect(maximumActive).toBe(1);
  });

  it("removes a cancelled waiter and admits replacement work", async () => {
    const gates: ReturnType<typeof deferred<Response>>[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => {
      const gate = deferred<Response>();
      gates.push(gate);
      return gate.promise;
    });
    const app = createHostedApplication(
      { ...baseEnvironment, PER_USER_DAILY_QUOTA: "2" },
      {
        validator: validator(),
        authorizationReadiness: { isReady: vi.fn().mockResolvedValue(true) },
        fetchImpl,
      },
    );
    const cancellation = new AbortController();

    const active = callSearch(app, 10);
    await vi.waitFor(() => {
      expect(gates).toHaveLength(1);
    });
    const cancelled = callSearch(app, 11, "subject-a", cancellation.signal);
    await Promise.resolve();
    cancellation.abort();
    const cancelledResponse = await cancelled;
    const replacement = callSearch(app, 12);
    gates[0]?.resolve(steamSearchResponse());
    await expect(active).resolves.toMatchObject({ status: 200 });
    await vi.waitFor(() => {
      expect(gates).toHaveLength(2);
    });
    gates[1]?.resolve(steamSearchResponse());
    await expect(replacement).resolves.toMatchObject({ status: 200 });

    expect(cancelledResponse.status).toBe(499);
  });

  it("resets both global and subject quota at a UTC day rollover", async () => {
    let now = new Date("2026-07-22T23:59:59.999Z");
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(steamSearchResponse()));
    const app = createHostedApplication(
      {
        ...baseEnvironment,
        GLOBAL_DAILY_QUOTA: "2",
        GLOBAL_SAFETY_RESERVE: "0",
        PER_USER_DAILY_QUOTA: "1",
      },
      {
        validator: validator(),
        authorizationReadiness: { isReady: vi.fn().mockResolvedValue(true) },
        fetchImpl,
        now: () => now,
      },
    );

    const beforeRollover = await callSearch(app, 20);
    const exhausted = await callSearch(app, 21);
    now = new Date("2026-07-23T00:00:00.000Z");
    const afterRollover = await callSearch(app, 22);

    await expect(
      Promise.all([
        toolErrorCode(beforeRollover),
        toolErrorCode(exhausted),
        toolErrorCode(afterRollover),
      ]),
    ).resolves.toEqual([undefined, "USER_QUOTA_EXCEEDED", undefined]);
  });

  it("preserves the configured global safety reserve across subjects", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(steamSearchResponse()));
    const app = createHostedApplication(
      {
        ...baseEnvironment,
        GLOBAL_DAILY_QUOTA: "3",
        GLOBAL_SAFETY_RESERVE: "1",
        PER_USER_DAILY_QUOTA: "2",
      },
      {
        validator: validator(),
        authorizationReadiness: { isReady: vi.fn().mockResolvedValue(true) },
        fetchImpl,
        now: () => new Date("2026-07-22T12:00:00.000Z"),
      },
    );

    const first = await callSearch(app, 30, "subject-a");
    const second = await callSearch(app, 31, "subject-b");
    const reserved = await callSearch(app, 32, "subject-c");

    await expect(
      Promise.all([
        toolErrorCode(first),
        toolErrorCode(second),
        toolErrorCode(reserved),
      ]),
    ).resolves.toEqual([undefined, undefined, "UPSTREAM_UNAVAILABLE"]);
  });

  it("bounds remembered subjects by the usable global budget", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(steamSearchResponse()));
    const app = createHostedApplication(
      {
        ...baseEnvironment,
        GLOBAL_DAILY_QUOTA: "4",
        GLOBAL_SAFETY_RESERVE: "1",
        PER_USER_DAILY_QUOTA: "1",
      },
      {
        validator: validator(),
        authorizationReadiness: { isReady: vi.fn().mockResolvedValue(true) },
        fetchImpl,
        now: () => new Date("2026-07-22T12:00:00.000Z"),
      },
    );

    const responses = [];
    for (let index = 0; index < 25; index += 1) {
      responses.push(
        await callSearch(app, 40 + index, `unique-subject-${String(index)}`),
      );
    }
    const codes = await Promise.all(responses.map(toolErrorCode));

    expect({
      admittedSubjects: fetchImpl.mock.calls.length,
      rejectedSubjects: codes.filter((code) => code === "UPSTREAM_UNAVAILABLE")
        .length,
    }).toEqual({ admittedSubjects: 3, rejectedSubjects: 22 });
  });

  it("releases capacity after an upstream dependency failure", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(
        new Error("synthetic configured dependency failure"),
      )
      .mockImplementation(() => Promise.resolve(steamSearchResponse()));
    const app = createHostedApplication(baseEnvironment, {
      validator: validator(),
      authorizationReadiness: { isReady: vi.fn().mockResolvedValue(true) },
      fetchImpl,
    });

    const failed = await callSearch(app, 70);
    const recovered = await callSearch(app, 71);

    await expect(
      Promise.all([toolErrorCode(failed), toolErrorCode(recovered)]),
    ).resolves.toEqual(["INTERNAL_ERROR", undefined]);
  });
});
