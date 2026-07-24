import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { executeSteamRequest } from "../steam/http/steam-http-client.js";
import type { SteamHttpRequest } from "../steam/http/steam-request.js";
import { SteamUpstreamError } from "../steam/http/steam-retry-policy.js";
import { parseLocalConfig } from "./config.js";
import { createSteamMcpServer } from "./steam-runtime.js";

type Environment = Readonly<Record<string, string | undefined>>;

interface LocalRuntimeOptions {
  readonly fetchImpl?: typeof fetch;
}

export function createLocalMcpServer(
  environment: Environment,
  options: LocalRuntimeOptions = {},
): McpServer {
  const config = parseLocalConfig(environment);
  return createSteamMcpServer({
    steamApiKey: config.steamApiKey ?? "",
    policy: config.policy,
    execute: createLocalSteamExecutor(
      config.steamApiKey,
      config.policy,
      options,
    ),
    ...(config.steamUser === undefined
      ? {}
      : { configuredDefault: config.steamUser }),
  });
}

function createLocalSteamExecutor(
  steamApiKey: string | undefined,
  policy: ReturnType<typeof parseLocalConfig>["policy"],
  options: LocalRuntimeOptions,
) {
  return (request: SteamHttpRequest, signal: AbortSignal) => {
    if (steamApiKey === undefined && requestRequiresApiKey(request)) {
      throw new SteamUpstreamError({
        code: "STEAM_AUTH_FAILED",
        retryable: false,
      });
    }
    return executeSteamRequest(request, {
      ...(options.fetchImpl === undefined
        ? {}
        : { fetchImpl: options.fetchImpl }),
      deadlineMs: policy.upstreamTimeoutMs,
      maxRetryAttempts: policy.maxRetryAttempts,
      maxResponseBytes: policy.maxOutputBytes,
      signal,
    });
  };
}

function requestRequiresApiKey(request: SteamHttpRequest): boolean {
  return new URL(request.url).searchParams.has("key");
}
