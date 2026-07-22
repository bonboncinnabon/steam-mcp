import { describe, expect, it, vi } from "vitest";

import { createHostedApplication } from "../../../src/infrastructure/hosted-runtime.js";

const accessToken = "synthetic-mcp-access-token-32-chars";
const environment = {
  STEAM_API_KEY: "synthetic-hosted-key",
  MCP_ACCESS_TOKEN: accessToken,
  MCP_RESOURCE_URI: "https://steam.example/mcp",
  ALLOWED_HOSTS: "steam.example",
} as const;

describe("hosted application composition", () => {
  it("does not expose OAuth metadata", async () => {
    const app = createHostedApplication(environment);

    const response = await app.handler.handle(
      new Request(
        "https://steam.example/.well-known/oauth-protected-resource/mcp",
        { headers: { host: "steam.example" } },
      ),
    );

    expect(response.status).toBe(404);
  });

  it("rejects disallowed hosts before health or MCP routing", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const app = createHostedApplication(environment, { fetchImpl });

    const responses = await Promise.all([
      app.handler.handle(
        new Request("https://steam.example/readyz", {
          headers: { host: "attacker.example" },
        }),
      ),
      app.handler.handle(
        new Request("https://steam.example/mcp", {
          method: "POST",
          headers: { host: "attacker.example" },
        }),
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is ready without an external authentication dependency", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const app = createHostedApplication(environment, { fetchImpl });

    const response = await app.handler.handle(
      new Request("https://steam.example/readyz", {
        headers: { host: "steam.example" },
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchImpl).not.toHaveBeenCalled();
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
    const app = createHostedApplication(environment, {
      quota: { reserve },
      concurrency: { acquire },
      fetchImpl,
    });

    const response = await app.handler.handle(
      new Request("https://steam.example/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${accessToken}`,
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
    expect(reserve).toHaveBeenCalledWith({ operation: "storeSearch", cost: 3 });
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
