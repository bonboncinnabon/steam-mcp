import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
} from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AccessTokenStatusPort } from "../../../src/application/ports/authorization.js";
import { createAccessTokenValidator } from "../../../src/infrastructure/oauth-token-validator.js";

const ISSUER = "https://login.example";
const AUDIENCE = "https://steam.example/mcp";
const NOW_SECONDS = 1_800_000_000;

let signPrimary: (claims?: Record<string, unknown>) => Promise<string>;
let signRotated: (claims?: Record<string, unknown>) => Promise<string>;
let keyResolver: JWTVerifyGetKey;

beforeAll(async () => {
  const primary = await generateKeyPair("RS256");
  const rotated = await generateKeyPair("RS256");
  const primaryJwk = await exportJWK(primary.publicKey);
  const rotatedJwk = await exportJWK(rotated.publicKey);
  keyResolver = createLocalJWKSet({
    keys: [
      { ...primaryJwk, alg: "RS256", kid: "primary", use: "sig" },
      { ...rotatedJwk, alg: "RS256", kid: "rotated", use: "sig" },
    ],
  });

  const createSigner =
    (
      privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"],
      kid: string,
    ) =>
    async (claims: Record<string, unknown> = {}) =>
      new SignJWT({
        scope: "steam:read",
        iss: ISSUER,
        aud: AUDIENCE,
        sub: "oauth-user-1",
        iat: NOW_SECONDS,
        exp: NOW_SECONDS + 300,
        ...claims,
      })
        .setProtectedHeader({ alg: "RS256", kid })
        .sign(privateKey);

  signPrimary = createSigner(primary.privateKey, "primary");
  signRotated = createSigner(rotated.privateKey, "rotated");
});

function activeStatus() {
  return {
    isActive: vi
      .fn<AccessTokenStatusPort["isActive"]>()
      .mockResolvedValue(true),
  };
}

function validator(
  tokenStatus: AccessTokenStatusPort = activeStatus(),
  resolver: JWTVerifyGetKey = keyResolver,
) {
  return createAccessTokenValidator({
    issuer: ISSUER,
    audience: AUDIENCE,
    requiredScopes: ["steam:read"],
    keyResolver: resolver,
    tokenStatus,
    now: () => new Date(NOW_SECONDS * 1_000),
  });
}

describe("createAccessTokenValidator", () => {
  it("returns the opaque subject and granted scopes for a current token", async () => {
    const token = await signPrimary({ scope: "steam:read profile" });

    await expect(validator().validate(token)).resolves.toEqual({
      authorized: true,
      context: {
        subject: "oauth-user-1",
        scopes: new Set(["steam:read", "profile"]),
      },
    });
  });

  it("accepts a newly rotated signing key", async () => {
    await expect(
      validator().validate(await signRotated()),
    ).resolves.toMatchObject({
      authorized: true,
    });
  });

  it("uses the platform clock when no clock is injected", async () => {
    const now = Math.floor(Date.now() / 1_000);
    const keyPair = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(keyPair.publicKey);
    const token = await new SignJWT({ scope: "steam:read" })
      .setProtectedHeader({ alg: "RS256", kid: "current" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject("oauth-user-1")
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(keyPair.privateKey);
    const currentValidator = createAccessTokenValidator({
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredScopes: ["steam:read"],
      keyResolver: createLocalJWKSet({
        keys: [{ ...publicJwk, alg: "RS256", kid: "current", use: "sig" }],
      }),
      tokenStatus: activeStatus(),
    });

    await expect(currentValidator.validate(token)).resolves.toMatchObject({
      authorized: true,
    });
  });

  it.each([
    ["blank", () => Promise.resolve("   ")],
    ["malformed", () => Promise.resolve("not-a-jwt")],
    ["wrong issuer", () => signPrimary({ iss: "https://attacker.example" })],
    ["wrong audience", () => signPrimary({ aud: "https://other.example/mcp" })],
    ["expired", () => signPrimary({ exp: NOW_SECONDS - 1 })],
    ["not active yet", () => signPrimary({ nbf: NOW_SECONDS + 60 })],
    ["missing subject", () => signPrimary({ sub: undefined })],
    ["non-string scope", () => signPrimary({ scope: ["steam:read"] })],
  ])("rejects a %s token without a status call", async (_name, makeToken) => {
    const tokenStatus = activeStatus();

    await expect(
      validator(tokenStatus).validate(await makeToken()),
    ).resolves.toEqual({ authorized: false, reason: "invalid_token" });
    expect(tokenStatus.isActive).not.toHaveBeenCalled();
  });

  it("distinguishes insufficient scope without checking token status", async () => {
    const tokenStatus = activeStatus();

    await expect(
      validator(tokenStatus).validate(await signPrimary({ scope: "profile" })),
    ).resolves.toEqual({ authorized: false, reason: "insufficient_scope" });
    expect(tokenStatus.isActive).not.toHaveBeenCalled();
  });

  it("requires every configured scope", async () => {
    const strictValidator = createAccessTokenValidator({
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredScopes: ["steam:read", "profile"],
      keyResolver,
      tokenStatus: activeStatus(),
      now: () => new Date(NOW_SECONDS * 1_000),
    });

    await expect(
      strictValidator.validate(await signPrimary()),
    ).resolves.toEqual({
      authorized: false,
      reason: "insufficient_scope",
    });
  });

  it("rejects a whitespace-only subject", async () => {
    await expect(
      validator().validate(await signPrimary({ sub: "   " })),
    ).resolves.toEqual({ authorized: false, reason: "invalid_token" });
  });

  it("normalizes repeated whitespace in the scope claim", async () => {
    await expect(
      validator().validate(
        await signPrimary({ scope: "  steam:read   profile  " }),
      ),
    ).resolves.toEqual({
      authorized: true,
      context: {
        subject: "oauth-user-1",
        scopes: new Set(["steam:read", "profile"]),
      },
    });
  });

  it("rejects a revoked or otherwise inactive token", async () => {
    const tokenStatus = { isActive: vi.fn().mockResolvedValue(false) };

    await expect(
      validator(tokenStatus).validate(await signPrimary()),
    ).resolves.toEqual({ authorized: false, reason: "invalid_token" });
  });

  it("fails closed when the token-status dependency fails", async () => {
    const tokenStatus = {
      isActive: vi.fn().mockRejectedValue(new Error("private provider detail")),
    };

    const result = await validator(tokenStatus).validate(await signPrimary());

    expect(result).toEqual({
      authorized: false,
      reason: "dependency_unavailable",
    });
    expect(JSON.stringify(result)).not.toContain("private provider detail");
  });

  it("fails closed when signing keys cannot be retrieved", async () => {
    const unavailableResolver: JWTVerifyGetKey = vi
      .fn()
      .mockRejectedValue(new Error("private JWKS detail"));

    const result = await validator(
      activeStatus(),
      unavailableResolver,
    ).validate(await signPrimary());

    expect(result).toEqual({
      authorized: false,
      reason: "dependency_unavailable",
    });
    expect(JSON.stringify(result)).not.toContain("private JWKS detail");
  });

  it("passes cancellation only to the status dependency", async () => {
    const signal = AbortSignal.abort("private cancellation reason");
    const tokenStatus = activeStatus();
    const token = await signPrimary();

    await validator(tokenStatus).validate(token, signal);

    expect(tokenStatus.isActive).toHaveBeenCalledWith(token, signal);
  });
});
