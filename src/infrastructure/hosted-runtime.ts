import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createRemoteJWKSet } from "jose";

import type { ConcurrencyPort } from "../application/ports/concurrency.js";
import type { AccessTokenStatusPort } from "../application/ports/authorization.js";
import type { QuotaPort } from "../application/ports/quota.js";
import type { ServicePolicy } from "../domain/service-policy.js";
import { executeSteamRequest } from "../steam/http/steam-http-client.js";
import type { SteamHttpRequest } from "../steam/http/steam-request.js";
import { SteamUpstreamError } from "../steam/http/steam-retry-policy.js";
import {
  createHealthHttpHandler,
  createHostedHttpRouter,
  type HttpRequestHandler,
  type ReadinessDependency,
} from "../transports/health.js";
import { createHostedMcpHttpHandler } from "../transports/http.js";
import {
  createHostedDiscoveryRouter,
  createOAuthMetadataHttpHandler,
} from "../transports/oauth-metadata.js";
import { parseHostedConfig, type HostedConfig } from "./config.js";
import { createHttpRequestBoundary } from "./http-request-boundary.js";
import { ConcurrencyAcquireError } from "./in-memory-concurrency.js";
import { createInMemoryConcurrency } from "./in-memory-concurrency.js";
import { createInMemoryQuota } from "./in-memory-quota.js";
import { createTokenIntrospectionClient } from "./oauth-token-introspection.js";
import {
  createAccessTokenValidator,
  type AccessTokenValidator,
} from "./oauth-token-validator.js";
import {
  createSteamMcpServer,
  type BestEffortSourcePolicy,
} from "./steam-runtime.js";

interface HostedMcpServerOptions {
  readonly steamApiKey: string;
  readonly subject: string;
  readonly policy: ServicePolicy;
  readonly quota: QuotaPort;
  readonly concurrency: ConcurrencyPort;
  readonly bestEffortSources?: BestEffortSourcePolicy;
  readonly fetchImpl?: typeof fetch;
}

type Environment = Readonly<Record<string, string | undefined>>;

export interface HostedApplication {
  readonly config: HostedConfig;
  readonly handler: HttpRequestHandler;
  readonly readiness: { readonly markNotReady: () => void };
}

interface HostedApplicationOptions {
  readonly validator?: AccessTokenValidator;
  readonly tokenStatus?: AccessTokenStatusPort;
  readonly authorizationReadiness?: ReadinessDependency;
  readonly quota?: QuotaPort;
  readonly concurrency?: ConcurrencyPort;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

export function createHostedApplication(
  environment: Environment,
  options: HostedApplicationOptions = {},
): HostedApplication {
  const config = parseHostedConfig(environment);
  const quota =
    options.quota ??
    createInMemoryQuota({
      globalDailyQuota: config.policy.globalDailyQuota,
      globalSafetyReserve: config.policy.globalSafetyReserve,
      perUserDailyQuota: config.policy.perUserDailyQuota,
      now: options.now ?? (() => new Date()),
    });
  const concurrency =
    options.concurrency ??
    createInMemoryConcurrency({
      maxHostConcurrency: config.policy.maxHostConcurrency,
      maxOperationConcurrency: config.policy.maxOperationConcurrency,
      maxQueueSize: config.policy.maxConcurrencyQueueSize,
    });
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenStatus =
    options.tokenStatus ??
    createTokenIntrospectionClient({
      endpoint: config.oauthIntrospectionUri,
      clientId: config.oauthClientId,
      clientSecret: config.oauthClientSecret,
      fetchImplementation: fetchImpl,
    });
  const validator =
    options.validator ??
    createAccessTokenValidator({
      issuer: config.oauthIssuer,
      audience: config.resourceUri,
      requiredScopes: ["steam:read"],
      keyResolver: createRemoteJWKSet(new URL(config.oauthJwksUri)),
      tokenStatus,
    });
  const resource = {
    resourceUri: config.resourceUri,
    authorizationServer: config.oauthIssuer,
    scopes: ["steam:read"],
  } as const;
  const mcp = createHostedMcpHttpHandler({
    resource,
    validator,
    allowedHosts: config.allowedHosts,
    allowedOrigins: config.allowedOrigins,
    maxActiveRequests: config.policy.maxConcurrencyQueueSize,
    createServer: (context) =>
      createHostedMcpServer({
        steamApiKey: config.steamApiKey,
        subject: context.subject,
        policy: config.policy,
        quota,
        concurrency,
        bestEffortSources: {
          wishlist: config.bestEffortWishlistEnabled,
          storeSearch: config.bestEffortStoreSearchEnabled,
          storeDetails: config.bestEffortStoreDetailsEnabled,
          deckCompatibility: config.bestEffortDeckCompatibilityEnabled,
          gameReviews: config.bestEffortGameReviewsEnabled,
        },
        fetchImpl,
      }),
  });
  const health = createHealthHttpHandler({
    authorization:
      options.authorizationReadiness ??
      createJwksReadiness(config.oauthJwksUri, fetchImpl),
  });
  const routedHandler = createHostedDiscoveryRouter({
    metadata: createOAuthMetadataHttpHandler(resource),
    next: createHostedHttpRouter({ health, mcp }),
  });
  const requestBoundary = createHttpRequestBoundary({
    allowedHosts: config.allowedHosts,
    allowedOrigins: config.allowedOrigins,
  });
  const handler: HttpRequestHandler = {
    async handle(request) {
      const decision = requestBoundary.check(request.headers);
      if (!decision.allowed) {
        return new Response(JSON.stringify({ error: "request_rejected" }), {
          status: decision.reason === "malformed_host" ? 400 : 403,
          headers: {
            "cache-control": "no-store",
            "content-type": "application/json",
          },
        });
      }
      return routedHandler.handle(request);
    },
  };

  return { config, handler, readiness: health };
}

export function createHostedMcpServer(
  options: HostedMcpServerOptions,
): McpServer {
  return createSteamMcpServer({
    steamApiKey: options.steamApiKey,
    policy: options.policy,
    execute: createHostedSteamExecutor(options),
    ...(options.bestEffortSources === undefined
      ? {}
      : { bestEffortSources: options.bestEffortSources }),
  });
}

function createHostedSteamExecutor(options: HostedMcpServerOptions) {
  return async (request: SteamHttpRequest, signal: AbortSignal) => {
    const reservation = await options.quota.reserve({
      subject: options.subject,
      operation: request.operation,
      // Reserve the worst-case HTTP attempts up front; unused retry capacity is
      // intentionally not refunded so the shared Steam budget cannot overspend.
      cost: options.policy.maxRetryAttempts + 1,
    });
    if (!reservation.reserved) {
      throw new SteamUpstreamError({
        code:
          reservation.reason === "user_exhausted"
            ? "USER_QUOTA_EXCEEDED"
            : "UPSTREAM_UNAVAILABLE",
        retryable: reservation.reason !== "user_exhausted",
      });
    }

    const host = new URL(request.url).hostname;
    let lease;
    try {
      lease = await options.concurrency.acquire(
        host,
        request.operation,
        signal,
      );
    } catch (error) {
      reservation.rollback();
      if (error instanceof ConcurrencyAcquireError) {
        throw new SteamUpstreamError({
          code: "UPSTREAM_UNAVAILABLE",
          retryable: true,
        });
      }
      throw error;
    }
    try {
      if (signal.aborted) {
        reservation.rollback();
        signal.throwIfAborted();
      }
      return await executeSteamRequest(request, {
        ...(options.fetchImpl === undefined
          ? {}
          : { fetchImpl: options.fetchImpl }),
        deadlineMs: options.policy.upstreamTimeoutMs,
        maxRetryAttempts: options.policy.maxRetryAttempts,
        maxResponseBytes: options.policy.maxOutputBytes,
        signal,
      });
    } finally {
      lease.release();
    }
  };
}

function createJwksReadiness(
  jwksUri: string,
  fetchImpl: typeof fetch,
): ReadinessDependency {
  let cached:
    { readonly value: boolean; readonly expiresAt: number } | undefined;
  let inFlight: Promise<boolean> | undefined;

  async function probe(): Promise<boolean> {
    const signal = AbortSignal.timeout(2_000);
    try {
      const response = await fetchImpl(jwksUri, {
        method: "GET",
        redirect: "error",
        headers: { accept: "application/json" },
        signal,
      });
      if (!response.ok) return false;
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > 65_536) return false;
      const parsed: unknown = JSON.parse(body);
      return (
        typeof parsed === "object" &&
        parsed !== null &&
        "keys" in parsed &&
        Array.isArray(parsed.keys) &&
        parsed.keys.length > 0
      );
    } catch {
      return false;
    }
  }

  return {
    async isReady(signal) {
      if (signal.aborted) return false;
      const now = Date.now();
      if (cached !== undefined && now < cached.expiresAt) return cached.value;
      inFlight ??= probe()
        .then((value) => {
          cached = { value, expiresAt: Date.now() + 30_000 };
          return value;
        })
        .finally(() => {
          inFlight = undefined;
        });
      return inFlight;
    },
  };
}
