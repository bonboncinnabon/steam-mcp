import { describe, expect, it } from "vitest";

import { createOAuthMetadataHttpHandler } from "../../../src/transports/oauth-metadata.js";

describe("OAuth metadata HTTP handler", () => {
  it("serves protected-resource metadata at the canonical discovery path", async () => {
    const handler = createOAuthMetadataHttpHandler({
      resourceUri: "https://steam.example/mcp",
      authorizationServer: "https://login.example",
      scopes: ["steam:read"],
    });

    const response = await handler.handle(
      new Request(
        "https://steam.example/.well-known/oauth-protected-resource/mcp",
      ),
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      resource: "https://steam.example/mcp",
      authorization_servers: ["https://login.example"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["steam:read"],
    });
  });
});
