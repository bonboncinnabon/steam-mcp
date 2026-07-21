import { describe, expect, it } from "vitest";

import {
  createAuthorizationErrorResponse,
  createProtectedResourceMetadataResponse,
  protectedResourceMetadataUrl,
} from "../../../src/infrastructure/oauth-resource.js";

const oauthResource = {
  resourceUri: "https://steam.example/mcp",
  authorizationServer: "https://login.example",
  scopes: ["steam:read"],
} as const;

describe("protectedResourceMetadataUrl", () => {
  it("derives the RFC 9728 path-aware metadata URL", () => {
    expect(protectedResourceMetadataUrl(oauthResource.resourceUri)).toBe(
      "https://steam.example/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("uses the root well-known path for an origin resource", () => {
    expect(protectedResourceMetadataUrl("https://steam.example")).toBe(
      "https://steam.example/.well-known/oauth-protected-resource",
    );
  });

  it("rejects a malformed resource URI with a sanitized error", () => {
    expect(() => protectedResourceMetadataUrl("private-invalid-value")).toThrow(
      "Invalid OAuth resource configuration",
    );
  });
});

describe("createProtectedResourceMetadataResponse", () => {
  it("returns canonical resource, authorization server, and scopes", () => {
    expect(createProtectedResourceMetadataResponse(oauthResource)).toEqual({
      status: 200,
      headers: {
        "cache-control": "public, max-age=300",
        "content-type": "application/json",
      },
      body: {
        resource: "https://steam.example/mcp",
        authorization_servers: ["https://login.example"],
        bearer_methods_supported: ["header"],
        scopes_supported: ["steam:read"],
      },
    });
  });

  it.each([
    ["insecure resource", { ...oauthResource, resourceUri: "http://x.test" }],
    [
      "resource query",
      { ...oauthResource, resourceUri: "https://steam.example/mcp?private=x" },
    ],
    [
      "insecure issuer",
      { ...oauthResource, authorizationServer: "http://login.example" },
    ],
    [
      "resource username",
      { ...oauthResource, resourceUri: "https://user@steam.example/mcp" },
    ],
    [
      "resource password",
      { ...oauthResource, resourceUri: "https://user:pass@steam.example/mcp" },
    ],
    [
      "resource fragment",
      { ...oauthResource, resourceUri: "https://steam.example/mcp#private" },
    ],
    ["empty scopes", { ...oauthResource, scopes: [] }],
    [
      "duplicate scopes",
      { ...oauthResource, scopes: ["steam:read", "steam:read"] },
    ],
    ["unsafe scope", { ...oauthResource, scopes: ["steam:read\r\nunsafe"] }],
    [
      "one unsafe scope",
      { ...oauthResource, scopes: ["steam:read", "unsafe scope"] },
    ],
  ])("rejects %s without reflecting the value", (_name, options) => {
    expect(() => createProtectedResourceMetadataResponse(options)).toThrow(
      "Invalid OAuth resource configuration",
    );
  });
});

describe("createAuthorizationErrorResponse", () => {
  it("challenges a missing token without claiming the token is invalid", () => {
    expect(
      createAuthorizationErrorResponse(oauthResource, "missing_token"),
    ).toEqual({
      status: 401,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json",
        "www-authenticate":
          'Bearer resource_metadata="https://steam.example/.well-known/oauth-protected-resource/mcp", scope="steam:read"',
      },
      body: { error: "unauthorized" },
    });
  });

  it("identifies an invalid token with a safe RFC 6750 error", () => {
    const response = createAuthorizationErrorResponse(
      oauthResource,
      "invalid_token",
    );

    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toContain(
      'error="invalid_token"',
    );
    expect(response.headers["www-authenticate"]).not.toContain(
      "synthetic-private-token",
    );
  });

  it("uses 403 and an insufficient-scope challenge", () => {
    const response = createAuthorizationErrorResponse(
      oauthResource,
      "insufficient_scope",
    );

    expect(response).toMatchObject({
      status: 403,
      body: { error: "forbidden" },
    });
    expect(response.headers["www-authenticate"]).toContain(
      'error="insufficient_scope"',
    );
  });

  it("separates multiple supported scopes with one space", () => {
    const response = createAuthorizationErrorResponse(
      { ...oauthResource, scopes: ["steam:read", "profile"] },
      "missing_token",
    );

    expect(response.headers["www-authenticate"]).toContain(
      'scope="steam:read profile"',
    );
  });
});
