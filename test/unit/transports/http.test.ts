import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { AccessTokenValidator } from "../../../src/infrastructure/oauth-token-validator.js";
import { STEAM_TOOL_CONTRACTS } from "../../../src/mcp/tool-contracts.js";
import {
  registerSteamTools,
  type SteamToolBindings,
} from "../../../src/mcp/tool-registry.js";
import {
  createHostedMcpHttpHandler as createHostedMcpHttpHandlerBase,
  type HostedMcpHttpHandlerOptions,
} from "../../../src/transports/http.js";

const resource = {
  resourceUri: "https://steam.example/mcp",
  authorizationServer: "https://login.example",
  scopes: ["steam:read"],
} as const;

function createHostedMcpHttpHandler(
  options: Omit<HostedMcpHttpHandlerOptions, "allowedHosts" | "allowedOrigins">,
) {
  const handler = createHostedMcpHttpHandlerBase({
    ...options,
    allowedHosts: ["steam.example"],
    allowedOrigins: ["https://client.example"],
  });

  return {
    handle(request: Request) {
      if (request.headers.has("host")) {
        return handler.handle(request);
      }
      const headers = new Headers(request.headers);
      headers.set("host", "steam.example");
      return handler.handle(new Request(request, { headers }));
    },
  };
}

function validValidator() {
  return {
    validate: vi.fn<AccessTokenValidator["validate"]>().mockResolvedValue({
      authorized: true,
      context: {
        subject: "oauth-user-1",
        scopes: new Set(["steam:read"]),
      },
    }),
  } satisfies AccessTokenValidator;
}

function initializationRequest(
  authorization = "Bearer synthetic-access-token",
): Request {
  return new Request(resource.resourceUri, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    }),
  });
}

function createServer(): McpServer {
  return new McpServer({ name: "steam-mcp-test", version: "1.0.0" });
}

describe("createHostedMcpHttpHandler", () => {
  it("bounds requests while authorization is still pending", async () => {
    let finishValidation:
      | ((value: Awaited<ReturnType<AccessTokenValidator["validate"]>>) => void)
      | undefined;
    const validator = {
      validate: vi.fn<AccessTokenValidator["validate"]>().mockImplementation(
        () =>
          new Promise((resolve) => {
            finishValidation = resolve;
          }),
      ),
    } satisfies AccessTokenValidator;
    const handler = createHostedMcpHttpHandler({
      resource,
      validator,
      createServer,
      maxActiveRequests: 1,
    });

    const first = handler.handle(initializationRequest());
    await vi.waitFor(() => {
      expect(validator.validate).toHaveBeenCalledOnce();
    });
    const second = handler.handle(initializationRequest());
    const secondOutcome = await Promise.race([
      second,
      new Promise<"timed_out">((resolve) => {
        setTimeout(() => {
          resolve("timed_out");
        }, 50);
      }),
    ]);

    expect(secondOutcome).not.toBe("timed_out");
    expect((secondOutcome as Response).status).toBe(429);
    expect(validator.validate).toHaveBeenCalledOnce();
    finishValidation?.({ authorized: false, reason: "invalid_token" });
    await expect(first).resolves.toMatchObject({ status: 401 });
  });

  it("handles authenticated initialization without creating a session", async () => {
    const serverFactory = vi.fn(createServer);
    const handler = createHostedMcpHttpHandler({
      resource,
      validator: validValidator(),
      createServer: serverFactory,
    });

    const response = await handler.handle(initializationRequest());
    const body = (await response.json()) as {
      result?: { protocolVersion?: string; serverInfo?: { name?: string } };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.has("mcp-session-id")).toBe(false);
    expect(body.result).toMatchObject({
      protocolVersion: "2025-11-25",
      serverInfo: { name: "steam-mcp-test" },
    });
    expect(serverFactory).toHaveBeenCalledWith({
      subject: "oauth-user-1",
      scopes: new Set(["steam:read"]),
    });
  });

  it("creates a fresh MCP server and transport for every request", async () => {
    const servers: McpServer[] = [];
    const handler = createHostedMcpHttpHandler({
      resource,
      validator: validValidator(),
      createServer: vi.fn(() => {
        const server = createServer();
        servers.push(server);
        return server;
      }),
    });

    const responses = await Promise.all([
      handler.handle(initializationRequest()),
      handler.handle(initializationRequest()),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(servers).toHaveLength(2);
    expect(servers[0]).not.toBe(servers[1]);
  });

  it("exposes exactly the shared eight-tool registry", async () => {
    const handler = createHostedMcpHttpHandler({
      resource,
      validator: validValidator(),
      createServer: () => {
        const server = createServer();
        const bindings = Object.fromEntries(
          Object.keys(STEAM_TOOL_CONTRACTS).map((name) => [
            name,
            vi.fn().mockResolvedValue({ content: [] }),
          ]),
        ) as unknown as SteamToolBindings;
        registerSteamTools(server, bindings);
        return server;
      },
    });

    const response = await handler.handle(
      new Request(resource.resourceUri, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer synthetic-access-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/list",
          params: {},
        }),
      }),
    );
    const body = (await response.json()) as {
      result?: { tools?: { name?: string }[] };
    };

    expect(response.status).toBe(200);
    expect(body.result?.tools?.map((tool) => tool.name)).toEqual(
      Object.keys(STEAM_TOOL_CONTRACTS),
    );
  });

  it("returns the OAuth challenge before constructing MCP application work", async () => {
    const serverFactory = vi.fn(createServer);
    const handler = createHostedMcpHttpHandler({
      resource,
      validator: validValidator(),
      createServer: serverFactory,
    });

    const response = await handler.handle(initializationRequest(""));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      "resource_metadata=",
    );
    expect(serverFactory).not.toHaveBeenCalled();
  });

  it.each([
    ["missing Host", {}, 400],
    ["disallowed Host", { host: "attacker.example" }, 403],
    [
      "untrusted forwarded Host",
      { host: "attacker.example", "x-forwarded-host": "steam.example" },
      403,
    ],
    [
      "disallowed Origin",
      { host: "steam.example", origin: "https://attacker.example" },
      403,
    ],
  ])(
    "rejects %s before authorization or MCP parsing",
    async (_name, boundaryHeaders, expectedStatus) => {
      const validator = validValidator();
      const serverFactory = vi.fn(createServer);
      const handler = createHostedMcpHttpHandlerBase({
        resource,
        validator,
        createServer: serverFactory,
        allowedHosts: ["steam.example"],
        allowedOrigins: ["https://client.example"],
      });

      const response = await handler.handle(
        new Request(resource.resourceUri, {
          method: "POST",
          headers: {
            ...boundaryHeaders,
            authorization: "Bearer synthetic-access-token",
            "content-type": "application/json",
          },
          body: "private malformed body",
        }),
      );

      expect(response.status).toBe(expectedStatus);
      expect(validator.validate).not.toHaveBeenCalled();
      expect(serverFactory).not.toHaveBeenCalled();
      expect(await response.text()).not.toContain("attacker.example");
    },
  );

  it("accepts a configured browser Origin", async () => {
    const handler = createHostedMcpHttpHandlerBase({
      resource,
      validator: validValidator(),
      createServer,
      allowedHosts: ["steam.example"],
      allowedOrigins: ["https://client.example"],
    });
    const request = initializationRequest();
    const headers = new Headers(request.headers);
    headers.set("host", "steam.example");
    headers.set("origin", "https://client.example");

    const response = await handler.handle(new Request(request, { headers }));

    expect(response.status).toBe(200);
  });

  it.each(["GET", "DELETE"])(
    "rejects legacy or stateful %s requests without an SSE stream",
    async (method) => {
      const serverFactory = vi.fn(createServer);
      const handler = createHostedMcpHttpHandler({
        resource,
        validator: validValidator(),
        createServer: serverFactory,
      });

      const response = await handler.handle(
        new Request(resource.resourceUri, {
          method,
          headers: { authorization: "Bearer synthetic-access-token" },
        }),
      );

      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(response.headers.get("content-type")).not.toContain(
        "text/event-stream",
      );
      expect(serverFactory).not.toHaveBeenCalled();
    },
  );

  it("binds the handler to the exact canonical resource URI", async () => {
    const validator = validValidator();
    const serverFactory = vi.fn(createServer);
    const handler = createHostedMcpHttpHandler({
      resource,
      validator,
      createServer: serverFactory,
    });

    const response = await handler.handle(
      new Request("https://steam.example/other", { method: "POST" }),
    );

    expect(response.status).toBe(404);
    expect(validator.validate).not.toHaveBeenCalled();
    expect(serverFactory).not.toHaveBeenCalled();
  });

  it.each([
    [
      "missing accepted media types",
      { "content-type": "application/json" },
      406,
    ],
    [
      "wrong content type",
      {
        accept: "application/json, text/event-stream",
        "content-type": "text/plain",
      },
      415,
    ],
  ])("rejects %s through the MCP transport", async (_name, headers, status) => {
    const handler = createHostedMcpHttpHandler({
      resource,
      validator: validValidator(),
      createServer,
    });

    const response = await handler.handle(
      new Request(resource.resourceUri, {
        method: "POST",
        headers: {
          ...headers,
          authorization: "Bearer synthetic-access-token",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/list",
          params: {},
        }),
      }),
    );

    expect(response.status).toBe(status);
  });

  it("returns an MCP parse error for malformed JSON", async () => {
    const handler = createHostedMcpHttpHandler({
      resource,
      validator: validValidator(),
      createServer,
    });

    const response = await handler.handle(
      new Request(resource.resourceUri, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer synthetic-access-token",
          "content-type": "application/json",
        },
        body: "not-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: -32_700 },
    });
  });

  it("returns 202 for a notification-only request", async () => {
    const handler = createHostedMcpHttpHandler({
      resource,
      validator: validValidator(),
      createServer,
    });

    const response = await handler.handle(
      new Request(resource.resourceUri, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer synthetic-access-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      }),
    );

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("closes an in-flight MCP server when the HTTP request is cancelled", async () => {
    const controller = new AbortController();
    const server = createServer();
    const close = vi.spyOn(server, "close");
    const handler = createHostedMcpHttpHandler({
      resource,
      validator: validValidator(),
      createServer: () => server,
    });
    const request = initializationRequest();
    const cancellableRequest = new Request(request, {
      signal: controller.signal,
    });

    controller.abort();
    await handler.handle(cancellableRequest);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("propagates in-flight HTTP cancellation to the MCP tool signal", async () => {
    const controller = new AbortController();
    let handlerSignal: AbortSignal | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const handler = createHostedMcpHttpHandler({
      resource,
      validator: validValidator(),
      createServer: () => {
        const server = createServer();
        server.registerTool(
          "wait",
          { inputSchema: z.strictObject({}) },
          (_input, extra) => {
            handlerSignal = extra.signal;
            markStarted?.();
            return new Promise((resolve) => {
              extra.signal.addEventListener(
                "abort",
                () => {
                  resolve({
                    content: [{ type: "text", text: "cancelled" }],
                  });
                },
                { once: true },
              );
            });
          },
        );
        return server;
      },
    });
    const call = handler.handle(
      new Request(resource.resourceUri, {
        method: "POST",
        signal: controller.signal,
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer synthetic-access-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "wait", arguments: {} },
        }),
      }),
    );

    await started;
    controller.abort();
    await call;

    expect(handlerSignal?.aborted).toBe(true);
  });

  it("correlates an MCP cancellation notification with active stateless work", async () => {
    let handlerSignal: AbortSignal | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const handler = createHostedMcpHttpHandler({
      resource,
      validator: validValidator(),
      maxActiveRequests: 1,
      createServer: () => {
        const server = createServer();
        server.registerTool(
          "wait",
          { inputSchema: z.strictObject({}) },
          (_input, extra) => {
            handlerSignal = extra.signal;
            markStarted?.();
            return new Promise((resolve) => {
              extra.signal.addEventListener(
                "abort",
                () => {
                  resolve({
                    content: [{ type: "text", text: "cancelled" }],
                  });
                },
                { once: true },
              );
            });
          },
        );
        return server;
      },
    });
    const activeCall = handler.handle(
      new Request(resource.resourceUri, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer synthetic-access-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "request-2",
          method: "tools/call",
          params: { name: "wait", arguments: {} },
        }),
      }),
    );
    await started;

    const cancellation = await handler.handle(
      new Request(resource.resourceUri, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer synthetic-access-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { requestId: "request-2", reason: "client cancelled" },
        }),
      }),
    );

    expect(cancellation.status).toBe(202);
    await activeCall;
    expect(handlerSignal?.aborted).toBe(true);
  });
});
