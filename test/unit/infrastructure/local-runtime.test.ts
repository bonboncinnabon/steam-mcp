import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { createLocalMcpServer } from "../../../src/infrastructure/local-runtime.js";

describe("local MCP runtime", () => {
  it("constructs and lists the eight tools without performing network I/O", async () => {
    const fetchImpl = vi.fn();
    const server = createLocalMcpServer({}, { fetchImpl });
    const client = new Client({
      name: "steam-mcp-local-test-client",
      version: "1.0.0",
    });
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

  it("returns a stable authentication error before network I/O when a key is required", async () => {
    const fetchImpl = vi.fn();
    const server = createLocalMcpServer({}, { fetchImpl });
    const client = new Client({
      name: "steam-mcp-local-test-client",
      version: "1.0.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    try {
      const result = await client.callTool({
        name: "steam_get_player",
        arguments: { user: "76561198000000001" },
      });

      expect(result).toMatchObject({
        isError: true,
        structuredContent: {
          ok: false,
          error: {
            code: "STEAM_AUTH_FAILED",
            message:
              "Steam authentication failed. Local users should set STEAM_API_KEY; hosted users should contact the server operator.",
            retryable: false,
          },
        },
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("keeps keyless Steam search available without an API key", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          total: 1,
          items: [{ type: "app", name: "Portal", id: 400 }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const server = createLocalMcpServer({}, { fetchImpl });
    const client = new Client({
      name: "steam-mcp-local-test-client",
      version: "1.0.0",
    });
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
        structuredContent: {
          ok: true,
          data: {
            query: "portal",
            candidates: [{ appId: 400, name: "Portal" }],
          },
        },
      });
      expect(fetchImpl).toHaveBeenCalledOnce();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
