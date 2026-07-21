export interface OAuthResourceOptions {
  readonly resourceUri: string;
  readonly authorizationServer: string;
  readonly scopes: readonly string[];
}

export interface OAuthHttpResponse<TBody> {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: TBody;
}

export type AuthorizationFailure =
  "missing_token" | "invalid_token" | "insufficient_scope";

const SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]+$/;

function parseHttpsUrl(value: string): URL {
  const url = new URL(value);

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Invalid OAuth resource configuration");
  }

  return url;
}

function validateOptions(options: OAuthResourceOptions): void {
  try {
    parseHttpsUrl(options.resourceUri);
    parseHttpsUrl(options.authorizationServer);
  } catch {
    throw new Error("Invalid OAuth resource configuration");
  }

  if (
    options.scopes.length === 0 ||
    new Set(options.scopes).size !== options.scopes.length ||
    options.scopes.some((scope) => !SCOPE_TOKEN.test(scope))
  ) {
    throw new Error("Invalid OAuth resource configuration");
  }
}

export function protectedResourceMetadataUrl(resourceUri: string): string {
  let resource: URL;

  try {
    resource = parseHttpsUrl(resourceUri);
  } catch {
    throw new Error("Invalid OAuth resource configuration");
  }

  const resourcePath = resource.pathname === "/" ? "" : resource.pathname;
  resource.pathname = `/.well-known/oauth-protected-resource${resourcePath}`;

  return resource.href;
}

export function createProtectedResourceMetadataResponse(
  options: OAuthResourceOptions,
): OAuthHttpResponse<{
  readonly resource: string;
  readonly authorization_servers: readonly string[];
  readonly bearer_methods_supported: readonly ["header"];
  readonly scopes_supported: readonly string[];
}> {
  validateOptions(options);

  return {
    status: 200,
    headers: {
      "cache-control": "public, max-age=300",
      "content-type": "application/json",
    },
    body: {
      resource: options.resourceUri,
      authorization_servers: [options.authorizationServer],
      bearer_methods_supported: ["header"],
      scopes_supported: [...options.scopes],
    },
  };
}

export function createAuthorizationErrorResponse(
  options: OAuthResourceOptions,
  failure: AuthorizationFailure,
): OAuthHttpResponse<{ readonly error: "forbidden" | "unauthorized" }> {
  validateOptions(options);

  const parameters = [
    `resource_metadata="${protectedResourceMetadataUrl(options.resourceUri)}"`,
    `scope="${options.scopes.join(" ")}"`,
  ];

  if (failure !== "missing_token") {
    parameters.push(`error="${failure}"`);
  }

  const insufficientScope = failure === "insufficient_scope";

  return {
    status: insufficientScope ? 403 : 401,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      "www-authenticate": `Bearer ${parameters.join(", ")}`,
    },
    body: { error: insufficientScope ? "forbidden" : "unauthorized" },
  };
}
