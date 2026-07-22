import { createHash, timingSafeEqual } from "node:crypto";

interface RemoteBearerGateOptions {
  readonly accessToken: string;
}

interface AuthenticationResponse {
  readonly status: 401;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: { readonly error: "unauthorized" };
}

export interface RemoteBearerGate {
  authenticate(
    authorizationHeader: string | undefined,
  ): AuthenticationResponse | undefined;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function authenticationRejection(): AuthenticationResponse {
  return {
    status: 401,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      "www-authenticate": "Bearer",
    },
    body: { error: "unauthorized" },
  };
}

export function createRemoteBearerGate(
  options: RemoteBearerGateOptions,
): RemoteBearerGate {
  const expectedDigest = digest(options.accessToken);

  return {
    authenticate(authorizationHeader) {
      if (authorizationHeader === undefined) return authenticationRejection();
      const match = /^Bearer ([^\s]+)$/iu.exec(authorizationHeader);
      if (
        match?.[1] === undefined ||
        !timingSafeEqual(digest(match[1]), expectedDigest)
      ) {
        return authenticationRejection();
      }
      return undefined;
    },
  };
}
