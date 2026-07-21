import type { AccessTokenStatusPort } from "../application/ports/authorization.js";

const MAX_INTROSPECTION_RESPONSE_BYTES = 4_096;

export class AuthorizationDependencyError extends Error {
  constructor() {
    super("Authorization dependency unavailable");
    this.name = "AuthorizationDependencyError";
  }
}

export interface TokenIntrospectionClientOptions {
  readonly endpoint: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetchImplementation?: typeof fetch;
}

function validateOptions(options: TokenIntrospectionClientOptions): void {
  try {
    const endpoint = new URL(options.endpoint);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username !== "" ||
      endpoint.password !== "" ||
      endpoint.search !== "" ||
      endpoint.hash !== "" ||
      options.clientId.trim().length === 0 ||
      options.clientSecret.trim().length === 0
    ) {
      throw new Error();
    }
  } catch {
    throw new Error("Invalid authorization dependency configuration");
  }
}

export function createTokenIntrospectionClient(
  options: TokenIntrospectionClientOptions,
): AccessTokenStatusPort {
  validateOptions(options);
  const fetchImplementation = options.fetchImplementation ?? fetch;

  return {
    async isActive(accessToken, signal) {
      try {
        const response = await fetchImplementation(options.endpoint, {
          method: "POST",
          redirect: "error",
          headers: {
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: options.clientId,
            client_secret: options.clientSecret,
            token: accessToken,
            token_type_hint: "access_token",
          }).toString(),
          ...(signal === undefined ? {} : { signal }),
        });

        if (!response.ok) {
          throw new AuthorizationDependencyError();
        }

        const body = await response.text();
        if (
          Buffer.byteLength(body, "utf8") > MAX_INTROSPECTION_RESPONSE_BYTES
        ) {
          throw new AuthorizationDependencyError();
        }

        const parsed: unknown = JSON.parse(body);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          !("active" in parsed) ||
          typeof parsed.active !== "boolean"
        ) {
          throw new AuthorizationDependencyError();
        }

        return parsed.active;
      } catch {
        throw new AuthorizationDependencyError();
      }
    },
  };
}
