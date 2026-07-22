import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";

import { createHostedMcpHttpHandler } from "../../../src/transports/http.js";

describe("remote HTTP bearer protection", () => {
  it("rejects a missing bearer token before constructing MCP work", async () => {
    const createServer = vi.fn(
      () => new McpServer({ name: "steam-mcp-test", version: "1.0.0" }),
    );
    const handler = createHostedMcpHttpHandler({
      resourceUri: "https://steam.example/mcp",
      accessToken: "synthetic-remote-access-token-value",
      allowedHosts: ["steam.example"],
      allowedOrigins: [],
      createServer,
    });

    const response = await handler.handle(
      new Request("https://steam.example/mcp", {
        method: "POST",
        headers: { host: "steam.example" },
        body: "private malformed body",
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(createServer).not.toHaveBeenCalled();
  });
});
