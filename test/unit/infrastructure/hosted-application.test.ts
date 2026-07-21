import { describe, expect, it, vi } from "vitest";

import type { AccessTokenValidator } from "../../../src/infrastructure/oauth-token-validator.js";
import { createHostedApplication } from "../../../src/infrastructure/hosted-runtime.js";

const environment = {
  STEAM_API_KEY: "synthetic-hosted-key",
  OAUTH_ISSUER: "https://login.example",
  OAUTH_JWKS_URI: "https://login.example/oauth2/jwks",
  OAUTH_INTROSPECTION_URI: "https://login.example/oauth2/introspection",
  OAUTH_CLIENT_ID: "synthetic-client-id",
  OAUTH_CLIENT_SECRET: "synthetic-client-secret",
  MCP_RESOURCE_URI: "https://steam.example/mcp",
  ALLOWED_HOSTS: "steam.example",
} as const;

describe("hosted application composition", () => {
  it("routes canonical OAuth metadata without authorization", async () => {
    const validator = {
      validate: vi.fn<AccessTokenValidator["validate"]>(),
    } satisfies AccessTokenValidator;
    const app = createHostedApplication(environment, {
      validator,
      authorizationReadiness: { isReady: vi.fn().mockResolvedValue(true) },
    });

    const response = await app.handler.handle(
      new Request(
        "https://steam.example/.well-known/oauth-protected-resource/mcp",
        { headers: { host: "steam.example" } },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resource: "https://steam.example/mcp",
      authorization_servers: ["https://login.example"],
    });
    expect(validator.validate).not.toHaveBeenCalled();
  });

  it("rejects disallowed hosts before metadata or health routing", async () => {
    const readiness = { isReady: vi.fn().mockResolvedValue(true) };
    const app = createHostedApplication(environment, {
      validator: { validate: vi.fn() },
      authorizationReadiness: readiness,
    });

    const responses = await Promise.all([
      app.handler.handle(
        new Request(
          "https://steam.example/.well-known/oauth-protected-resource/mcp",
          { headers: { host: "attacker.example" } },
        ),
      ),
      app.handler.handle(
        new Request("https://steam.example/readyz", {
          headers: { host: "attacker.example" },
        }),
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403]);
    expect(readiness.isReady).not.toHaveBeenCalled();
  });

  it("reports ready only when the configured signing-key dependency responds", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ kty: "RSA", kid: "key-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const app = createHostedApplication(environment, { fetchImpl });

    const response = await app.handler.handle(
      new Request("https://steam.example/readyz", {
        headers: { host: "steam.example" },
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://login.example/oauth2/jwks",
      expect.objectContaining({ method: "GET", redirect: "error" }),
    );
  });

  it("reuses a recent bounded JWKS readiness result", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ kty: "RSA", kid: "key-1" }] }), {
        status: 200,
      }),
    );
    const app = createHostedApplication(environment, { fetchImpl });
    const request = () =>
      new Request("https://steam.example/readyz", {
        headers: { host: "steam.example" },
      });

    const responses = await Promise.all([
      app.handler.handle(request()),
      app.handler.handle(request()),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("executes authorized tools through shared quota and concurrency without token passthrough", async () => {
    const reserve = vi
      .fn()
      .mockResolvedValue({ reserved: true, remaining: 99 });
    const release = vi.fn();
    const acquire = vi.fn().mockResolvedValue({ release });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          total: 1,
          items: [{ type: "app", name: "Portal", id: 400 }],
        }),
        { status: 200 },
      ),
    );
    const validator = {
      validate: vi.fn<AccessTokenValidator["validate"]>().mockResolvedValue({
        authorized: true,
        context: {
          subject: "oauth-subject",
          scopes: new Set(["steam:read"]),
        },
      }),
    } satisfies AccessTokenValidator;
    const app = createHostedApplication(environment, {
      validator,
      authorizationReadiness: { isReady: vi.fn().mockResolvedValue(true) },
      quota: { reserve },
      concurrency: { acquire },
      fetchImpl,
    });

    const response = await app.handler.handle(
      new Request("https://steam.example/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer synthetic-mcp-token",
          "content-type": "application/json",
          host: "steam.example",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "steam_search_games",
            arguments: { query: "portal" },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(reserve).toHaveBeenCalledWith({
      subject: "oauth-subject",
      operation: "storeSearch",
      cost: 3,
    });
    expect(acquire).toHaveBeenCalledWith(
      "store.steampowered.com",
      "storeSearch",
      expect.any(AbortSignal),
    );
    const [upstreamUrl, upstreamInit] = fetchImpl.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(upstreamUrl).toContain("store.steampowered.com/api/storesearch");
    expect(new Headers(upstreamInit.headers).has("authorization")).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });
});
