import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { BASELINE_SERVICE_POLICY } from "../../../src/domain/service-policy.js";
import { createHostedMcpServer } from "../../../src/infrastructure/hosted-runtime.js";
import { ConcurrencyAcquireError } from "../../../src/infrastructure/in-memory-concurrency.js";

describe("hosted MCP runtime", () => {
  it("constructs the complete public tool surface without network work", async () => {
    const fetchImpl = vi.fn();
    const server = createHostedMcpServer({
      steamApiKey: "synthetic-hosted-key",
      subject: "oauth-subject",
      policy: BASELINE_SERVICE_POLICY,
      quota: { reserve: vi.fn() },
      concurrency: { acquire: vi.fn() },
      fetchImpl,
    });
    const client = new Client({ name: "hosted-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    try {
      const listed = await client.listTools();

      expect(listed.tools.map((tool) => tool.name)).toEqual([
        "steam_get_player",
        "steam_get_library",
        "steam_get_recent_activity",
        "steam_get_achievements",
        "steam_get_friends",
        "steam_get_wishlist",
        "steam_search_games",
        "steam_get_game",
      ]);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects exhausted subject quota before concurrency or Steam work", async () => {
    const reserve = vi.fn().mockResolvedValue({
      reserved: false,
      reason: "user_exhausted",
    });
    const acquire = vi.fn();
    const fetchImpl = vi.fn();
    const server = createHostedMcpServer({
      steamApiKey: "synthetic-hosted-key",
      subject: "oauth-subject",
      policy: BASELINE_SERVICE_POLICY,
      quota: { reserve },
      concurrency: { acquire },
      fetchImpl,
    });
    const client = new Client({ name: "hosted-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    try {
      const result = await client.callTool({
        name: "steam_search_games",
        arguments: { query: "portal" },
      });

      expect(result).toMatchObject({
        isError: true,
        structuredContent: {
          ok: false,
          error: { code: "USER_QUOTA_EXCEEDED", retryable: false },
        },
      });
      expect(reserve).toHaveBeenCalledWith({
        subject: "oauth-subject",
        operation: "storeSearch",
        cost: 3,
      });
      expect(acquire).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("maps a saturated concurrency queue to a retryable capacity error", async () => {
    const rollback = vi.fn();
    const reserve = vi
      .fn()
      .mockResolvedValue({ reserved: true, remaining: 99, rollback });
    const acquire = vi
      .fn()
      .mockRejectedValue(new ConcurrencyAcquireError("queue_full"));
    const fetchImpl = vi.fn();
    const server = createHostedMcpServer({
      steamApiKey: "synthetic-hosted-key",
      subject: "oauth-subject",
      policy: BASELINE_SERVICE_POLICY,
      quota: { reserve },
      concurrency: { acquire },
      fetchImpl,
    });
    const client = new Client({ name: "hosted-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    try {
      const result = await client.callTool({
        name: "steam_search_games",
        arguments: { query: "portal" },
      });

      expect(result).toMatchObject({
        isError: true,
        structuredContent: {
          ok: false,
          error: { code: "UPSTREAM_UNAVAILABLE", retryable: true },
        },
      });
      expect(acquire).toHaveBeenCalledWith(
        "store.steampowered.com",
        "storeSearch",
        expect.any(AbortSignal),
      );
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(rollback).toHaveBeenCalledOnce();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rolls quota back when cancellation wins the concurrency handoff", async () => {
    const rollback = vi.fn();
    const release = vi.fn();
    const acquire = vi.fn(
      (_host: string, _operation: string, signal: AbortSignal) =>
        new Promise<{ release(): void }>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              resolve({ release });
            },
            { once: true },
          );
        }),
    );
    const fetchImpl = vi.fn();
    const server = createHostedMcpServer({
      steamApiKey: "synthetic-hosted-key",
      subject: "oauth-subject",
      policy: BASELINE_SERVICE_POLICY,
      quota: {
        reserve: vi
          .fn()
          .mockResolvedValue({ reserved: true, remaining: 99, rollback }),
      },
      concurrency: { acquire },
      fetchImpl,
    });
    const client = new Client({ name: "hosted-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const cancellation = new AbortController();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    try {
      const call = client.callTool(
        { name: "steam_search_games", arguments: { query: "portal" } },
        undefined,
        { signal: cancellation.signal },
      );
      await vi.waitFor(() => {
        expect(acquire).toHaveBeenCalledOnce();
      });

      cancellation.abort();

      await expect(call).rejects.toThrow();
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(rollback).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledOnce();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
