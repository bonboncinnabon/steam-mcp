import type { AuthorizationContext } from "../application/ports/authorization.js";
import type { AccessTokenValidator } from "./oauth-token-validator.js";
import {
  createAuthorizationErrorResponse,
  createProtectedResourceMetadataResponse,
  type OAuthHttpResponse,
  type OAuthResourceOptions,
} from "./oauth-resource.js";

export interface HostedAuthorizationGateOptions {
  readonly resource: OAuthResourceOptions;
  readonly validator: AccessTokenValidator;
}

export interface HostedAuthorizationGate {
  run<T>(input: {
    readonly authorizationHeader?: string;
    readonly signal?: AbortSignal;
    readonly execute: (
      context: AuthorizationContext,
      signal?: AbortSignal,
    ) => Promise<T>;
  }): Promise<
    | { readonly authorized: true; readonly value: T }
    | {
        readonly authorized: false;
        readonly response: OAuthHttpResponse<{
          readonly error:
            "forbidden" | "temporarily_unavailable" | "unauthorized";
        }>;
      }
  >;
}

function dependencyUnavailableResponse(): OAuthHttpResponse<{
  readonly error: "temporarily_unavailable";
}> {
  return {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      "retry-after": "5",
    },
    body: { error: "temporarily_unavailable" },
  };
}

export function createHostedAuthorizationGate(
  options: HostedAuthorizationGateOptions,
): HostedAuthorizationGate {
  createProtectedResourceMetadataResponse(options.resource);

  return {
    async run(input) {
      if (input.authorizationHeader === undefined) {
        return {
          authorized: false,
          response: createAuthorizationErrorResponse(
            options.resource,
            "missing_token",
          ),
        };
      }

      const match = /^Bearer ([^\s]+)$/iu.exec(input.authorizationHeader);
      if (match?.[1] === undefined) {
        return {
          authorized: false,
          response: createAuthorizationErrorResponse(
            options.resource,
            "invalid_token",
          ),
        };
      }

      const validation = await options.validator.validate(
        match[1],
        input.signal,
      );
      if (!validation.authorized) {
        if (validation.reason === "dependency_unavailable") {
          return {
            authorized: false,
            response: dependencyUnavailableResponse(),
          };
        }

        return {
          authorized: false,
          response: createAuthorizationErrorResponse(
            options.resource,
            validation.reason,
          ),
        };
      }

      return {
        authorized: true,
        value: await input.execute(validation.context, input.signal),
      };
    },
  };
}
