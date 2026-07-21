import { describe, expect, it, vi } from "vitest";

import {
  AuthorizationDependencyError,
  createTokenIntrospectionClient,
} from "../../../src/infrastructure/oauth-token-introspection.js";

const options = {
  endpoint: "https://login.example/oauth2/introspection",
  clientId: "client_test",
  clientSecret: "synthetic-client-secret",
} as const;

describe("createTokenIntrospectionClient", () => {
  it("can be constructed with the platform fetch implementation", () => {
    expect(typeof createTokenIntrospectionClient(options).isActive).toBe(
      "function",
    );
  });

  it("posts the token to the configured provider and returns active status", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ active: true, scope: "steam:read" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createTokenIntrospectionClient({
      ...options,
      fetchImplementation,
    });

    await expect(client.isActive("synthetic-access-token")).resolves.toBe(true);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImplementation.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(options.endpoint);
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
    });
    expect(init).not.toHaveProperty("signal");
    expect(typeof init.body).toBe("string");
    expect(new URLSearchParams(init.body as string)).toEqual(
      new URLSearchParams({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        token: "synthetic-access-token",
        token_type_hint: "access_token",
      }),
    );
  });

  it("returns false for an inactive token", async () => {
    const client = createTokenIntrospectionClient({
      ...options,
      fetchImplementation: vi
        .fn()
        .mockResolvedValue(new Response('{"active":false}', { status: 200 })),
    });

    await expect(client.isActive("synthetic-access-token")).resolves.toBe(
      false,
    );
  });

  it.each([
    ["provider rejection", new Response('{"active":true}', { status: 503 })],
    ["malformed JSON", new Response("not-json", { status: 200 })],
    ["missing status", new Response('{"scope":"steam:read"}', { status: 200 })],
    ["null response", new Response("null", { status: 200 })],
    ["primitive response", new Response("true", { status: 200 })],
    ["invalid status type", new Response('{"active":"true"}', { status: 200 })],
    [
      "oversized response",
      new Response(`{"active":true,"x":"${"x".repeat(4096)}"}`, {
        status: 200,
      }),
    ],
  ])("fails closed with a sanitized error for %s", async (_name, response) => {
    const client = createTokenIntrospectionClient({
      ...options,
      fetchImplementation: vi.fn().mockResolvedValue(response),
    });

    const error = await client
      .isActive("synthetic-access-token")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthorizationDependencyError);
    expect((error as Error).message).toBe(
      "Authorization dependency unavailable",
    );
    expect((error as Error).name).toBe("AuthorizationDependencyError");
    expect(JSON.stringify(error)).not.toContain("synthetic-access-token");
    expect(JSON.stringify(error)).not.toContain(options.clientSecret);
  });

  it("sanitizes network failures and forwards cancellation", async () => {
    const signal = new AbortController().signal;
    const fetchImplementation = vi
      .fn()
      .mockRejectedValue(new Error("private network detail"));
    const client = createTokenIntrospectionClient({
      ...options,
      fetchImplementation,
    });

    await expect(
      client.isActive("synthetic-access-token", signal),
    ).rejects.toThrow("Authorization dependency unavailable");
    expect(fetchImplementation).toHaveBeenCalledWith(
      options.endpoint,
      expect.objectContaining({ signal }),
    );
  });

  it.each([
    [
      "insecure endpoint",
      { ...options, endpoint: "http://login.example/status" },
    ],
    [
      "embedded credential",
      { ...options, endpoint: "https://user@login.example/status" },
    ],
    [
      "embedded password",
      { ...options, endpoint: "https://user:pass@login.example/status" },
    ],
    [
      "endpoint query",
      { ...options, endpoint: "https://login.example/status?private=x" },
    ],
    [
      "endpoint fragment",
      { ...options, endpoint: "https://login.example/status#private" },
    ],
    ["blank client id", { ...options, clientId: " " }],
    ["blank client secret", { ...options, clientSecret: " " }],
  ])("rejects %s without reflecting configuration", (_name, invalidOptions) => {
    expect(() =>
      createTokenIntrospectionClient({
        ...invalidOptions,
        fetchImplementation: vi.fn(),
      }),
    ).toThrow("Invalid authorization dependency configuration");
  });
});
