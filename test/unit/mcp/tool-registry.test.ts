import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";

import { failure, success } from "../../../src/domain/result.js";
import {
  createSteamToolContracts,
  STEAM_TOOL_CONTRACTS,
} from "../../../src/mcp/tool-contracts.js";
import {
  registerSteamTools,
  type SteamToolBindings,
} from "../../../src/mcp/tool-registry.js";

describe("Steam MCP tool registry", () => {
  it("advertises every shared input and output contract through the MCP SDK", async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: "steam-mcp-test", version: "1.0.0" });
    const client = new Client({
      name: "steam-mcp-test-client",
      version: "1.0.0",
    });
    const bindings = Object.fromEntries(
      Object.keys(STEAM_TOOL_CONTRACTS).map((name) => [name, vi.fn()]),
    ) as unknown as SteamToolBindings;
    registerSteamTools(server, bindings);

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    try {
      const listed = await client.listTools();

      expect(listed.tools.map((tool) => tool.name)).toEqual(
        Object.keys(STEAM_TOOL_CONTRACTS),
      );
      expect(
        listed.tools.every(
          (tool) =>
            tool.inputSchema["additionalProperties"] === false &&
            tool.outputSchema?.["additionalProperties"] === false,
        ),
      ).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("preserves structured success and error results across registry constructions", async () => {
    const successResult = success({ query: "portal", candidates: [] }, [
      "best_effort",
    ]);
    const errorResult = failure("INVALID_INPUT", "Invalid search query", false);

    await expect(
      callSearchWithResult({
        content: [{ type: "text", text: "No candidates." }],
        structuredContent: successResult,
      }),
    ).resolves.toMatchObject({ structuredContent: successResult });
    await expect(
      callSearchWithResult({
        isError: true,
        content: [{ type: "text", text: "Invalid search query" }],
        structuredContent: errorResult,
      }),
    ).resolves.toMatchObject({ isError: true, structuredContent: errorResult });
  });

  it("advertises the active runtime bounds instead of baseline bounds", async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: "steam-mcp-test", version: "1.0.0" });
    const client = new Client({
      name: "steam-mcp-test-client",
      version: "1.0.0",
    });
    const bindings = Object.fromEntries(
      Object.keys(STEAM_TOOL_CONTRACTS).map((name) => [name, vi.fn()]),
    ) as unknown as SteamToolBindings;
    const contracts = createSteamToolContracts({
      defaultPageSize: 7,
      maxPageSize: 17,
      maxSearchResults: 4,
    });

    registerSteamTools(server, bindings, contracts);
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    try {
      const listed = await client.listTools();
      const library = listed.tools.find(
        (tool) => tool.name === "steam_get_library",
      );
      const search = listed.tools.find(
        (tool) => tool.name === "steam_search_games",
      );

      expect(library?.inputSchema.properties).toMatchObject({
        limit: { default: 7, maximum: 17 },
      });
      expect(search?.inputSchema.properties).toMatchObject({
        limit: { default: 4, maximum: 4 },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("propagates MCP request cancellation into a running tool handler", async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: "steam-mcp-test", version: "1.0.0" });
    const client = new Client({
      name: "steam-mcp-test-client",
      version: "1.0.0",
    });
    let handlerSignal: AbortSignal | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const bindings = Object.fromEntries(
      Object.keys(STEAM_TOOL_CONTRACTS).map((name) => [name, vi.fn()]),
    ) as unknown as SteamToolBindings;
    const cancellableSearch: SteamToolBindings["steam_search_games"] = (
      _input,
      extra,
    ) => {
      handlerSignal = extra.signal;
      markStarted?.();
      return new Promise((resolve) => {
        extra.signal.addEventListener(
          "abort",
          () => {
            resolve({
              isError: true,
              content: [{ type: "text", text: "cancelled" }],
              structuredContent: failure(
                "UPSTREAM_UNAVAILABLE",
                "cancelled",
                true,
              ),
            });
          },
          { once: true },
        );
      });
    };
    const cancellableBindings = {
      ...bindings,
      steam_search_games: vi.fn(cancellableSearch),
    } satisfies SteamToolBindings;
    registerSteamTools(server, cancellableBindings);
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const controller = new AbortController();
    try {
      const call = client.callTool(
        { name: "steam_search_games", arguments: { query: "portal" } },
        undefined,
        { signal: controller.signal },
      );
      await started;

      controller.abort();

      await expect(call).rejects.toThrow();
      expect(handlerSignal?.aborted).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

async function callSearchWithResult(result: {
  readonly isError?: boolean;
  readonly content: readonly [{ readonly type: "text"; readonly text: string }];
  readonly structuredContent: object;
}) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: "steam-mcp-test", version: "1.0.0" });
  const client = new Client({
    name: "steam-mcp-test-client",
    version: "1.0.0",
  });
  const bindings = Object.fromEntries(
    Object.keys(STEAM_TOOL_CONTRACTS).map((name) => [name, vi.fn()]),
  ) as unknown as SteamToolBindings;
  const searchBindings = {
    ...bindings,
    steam_search_games: vi.fn().mockResolvedValue(result),
  } as SteamToolBindings;
  registerSteamTools(server, searchBindings);
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    return await client.callTool({
      name: "steam_search_games",
      arguments: { query: "portal" },
    });
  } finally {
    await client.close();
    await server.close();
  }
}
