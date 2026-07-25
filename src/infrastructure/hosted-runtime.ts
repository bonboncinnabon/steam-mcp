import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ConcurrencyPort } from "../application/ports/concurrency.js";
import type { QuotaPort } from "../application/ports/quota.js";
import type { ServicePolicy } from "../domain/service-policy.js";
import { executeSteamRequest } from "../steam/http/steam-http-client.js";
import type { SteamHttpRequest } from "../steam/http/steam-request.js";
import { SteamUpstreamError } from "../steam/http/steam-retry-policy.js";
import {
  createHealthHttpHandler,
  createHostedHttpRouter,
  type HttpRequestHandler,
} from "../transports/health.js";
import { createHostedMcpHttpHandler } from "../transports/http.js";
import { parseHostedConfig, type HostedConfig } from "./config.js";
import { createHttpRequestBoundary } from "./http-request-boundary.js";
import { ConcurrencyAcquireError } from "./in-memory-concurrency.js";
import { createInMemoryConcurrency } from "./in-memory-concurrency.js";
import { createInMemoryQuota } from "./in-memory-quota.js";
import {
  createSteamMcpServer,
  type BestEffortSourcePolicy,
} from "./steam-runtime.js";

interface HostedMcpServerOptions {
  readonly steamApiKey: string;
  readonly steamUser?: string;
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
  const mcp = createHostedMcpHttpHandler({
    resourceUri: config.resourceUri,
    accessToken: config.accessToken,
    maxActiveRequests: config.policy.maxConcurrencyQueueSize,
    createServer: () =>
      createHostedMcpServer({
        steamApiKey: config.steamApiKey,
        ...(config.steamUser === undefined
          ? {}
          : { steamUser: config.steamUser }),
        policy: config.policy,
        quota,
        concurrency,
        bestEffortSources: config.bestEffortSources,
        fetchImpl,
      }),
  });
  const health = createHealthHttpHandler({});
  const routedHandler = createHostedHttpRouter({ health, mcp });
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
    ...(options.steamUser === undefined
      ? {}
      : { configuredDefault: options.steamUser }),
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
      operation: request.operation,
      // Reserve the worst-case HTTP attempts up front; unused retry capacity is
      // intentionally not refunded so the shared Steam budget cannot overspend.
      cost: options.policy.maxRetryAttempts + 1,
    });
    if (!reservation.reserved) {
      throw new SteamUpstreamError({
        code:
          reservation.reason === "global_reserve"
            ? "SERVICE_QUOTA_EXCEEDED"
            : "UPSTREAM_UNAVAILABLE",
        retryable: reservation.reason !== "global_reserve",
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
