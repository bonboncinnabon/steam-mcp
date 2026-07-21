import { errors, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from "jose";

import type {
  AccessTokenStatusPort,
  AuthorizationContext,
} from "../application/ports/authorization.js";

export type AccessTokenValidation =
  | {
      readonly authorized: true;
      readonly context: AuthorizationContext;
    }
  | {
      readonly authorized: false;
      readonly reason:
        "dependency_unavailable" | "insufficient_scope" | "invalid_token";
    };

export interface AccessTokenValidator {
  validate(
    accessToken: string,
    signal?: AbortSignal,
  ): Promise<AccessTokenValidation>;
}

export interface AccessTokenValidatorOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly requiredScopes: readonly string[];
  readonly keyResolver: JWTVerifyGetKey;
  readonly tokenStatus: AccessTokenStatusPort;
  readonly now?: () => Date;
}

function invalidToken(): AccessTokenValidation {
  return { authorized: false, reason: "invalid_token" };
}

function dependencyUnavailable(): AccessTokenValidation {
  return { authorized: false, reason: "dependency_unavailable" };
}

function isKeyDependencyFailure(error: unknown): boolean {
  return (
    !(error instanceof errors.JOSEError) || error.code === "ERR_JWKS_TIMEOUT"
  );
}

function authorizationContext(
  payload: JWTPayload,
): AuthorizationContext | undefined {
  if (
    typeof payload.sub !== "string" ||
    payload.sub.trim().length === 0 ||
    typeof payload["scope"] !== "string"
  ) {
    return undefined;
  }

  return {
    subject: payload.sub,
    scopes: new Set(payload["scope"].split(/\s+/u).filter(Boolean)),
  };
}

export function createAccessTokenValidator(
  options: AccessTokenValidatorOptions,
): AccessTokenValidator {
  const requiredScopes = new Set(options.requiredScopes);

  return {
    async validate(accessToken, signal) {
      if (accessToken.trim().length === 0) {
        return invalidToken();
      }

      let payload: JWTPayload;

      try {
        ({ payload } = await jwtVerify(accessToken, options.keyResolver, {
          algorithms: ["RS256"],
          audience: options.audience,
          currentDate: options.now?.() ?? new Date(),
          issuer: options.issuer,
        }));
      } catch (error) {
        return isKeyDependencyFailure(error)
          ? dependencyUnavailable()
          : invalidToken();
      }

      const context = authorizationContext(payload);
      if (context === undefined) {
        return invalidToken();
      }

      if ([...requiredScopes].some((scope) => !context.scopes.has(scope))) {
        return { authorized: false, reason: "insufficient_scope" };
      }

      try {
        return (await options.tokenStatus.isActive(accessToken, signal))
          ? { authorized: true, context }
          : invalidToken();
      } catch {
        return dependencyUnavailable();
      }
    },
  };
}
