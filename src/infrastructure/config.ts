import { URL } from "node:url";

import {
  createServicePolicy,
  type ServicePolicy,
} from "../domain/service-policy.js";
import { createHttpRequestBoundary } from "./http-request-boundary.js";

export interface LocalConfig {
  readonly mode: "local";
  readonly steamApiKey?: string;
  readonly steamUser?: string;
  readonly policy: ServicePolicy;
}

export interface HostedConfig {
  readonly mode: "hosted";
  readonly steamApiKey: string;
  readonly accessToken: string;
  readonly resourceUri: string;
  readonly allowedHosts: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly listenHost: string;
  readonly port: number;
  readonly shutdownDrainTimeoutMs: number;
  readonly bestEffortWishlistEnabled: boolean;
  readonly bestEffortStoreSearchEnabled: boolean;
  readonly bestEffortStoreDetailsEnabled: boolean;
  readonly bestEffortDeckCompatibilityEnabled: boolean;
  readonly bestEffortGameReviewsEnabled: boolean;
  readonly policy: ServicePolicy;
}

type Environment = Readonly<Record<string, string | undefined>>;

const POLICY_ENVIRONMENT_FIELDS = [
  ["UPSTREAM_TIMEOUT_MS", "upstreamTimeoutMs"],
  ["MAX_RETRY_ATTEMPTS", "maxRetryAttempts"],
  ["GLOBAL_DAILY_QUOTA", "globalDailyQuota"],
  ["GLOBAL_SAFETY_RESERVE", "globalSafetyReserve"],
  ["MAX_HOST_CONCURRENCY", "maxHostConcurrency"],
  ["MAX_OPERATION_CONCURRENCY", "maxOperationConcurrency"],
  ["MAX_CONCURRENCY_QUEUE_SIZE", "maxConcurrencyQueueSize"],
  ["MAX_TOOL_FAN_OUT", "maxToolFanOut"],
  ["DEFAULT_PAGE_SIZE", "defaultPageSize"],
  ["MAX_PAGE_SIZE", "maxPageSize"],
  ["EXECUTION_DEADLINE_MS", "executionDeadlineMs"],
  ["MAX_OUTPUT_BYTES", "maxOutputBytes"],
] as const satisfies readonly (readonly [string, keyof ServicePolicy])[];

function optionalNonBlank(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value;
}

function required(environment: Environment, name: string): string {
  const value = environment[name];

  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required configuration: ${name}`);
  }

  return value;
}

function requiredAccessToken(environment: Environment): string {
  const value = required(environment, "MCP_ACCESS_TOKEN");
  if (value.length < 32) {
    throw new Error("MCP_ACCESS_TOKEN must contain at least 32 characters");
  }
  if (!/^[A-Za-z0-9._~+/=-]+$/.test(value)) {
    throw new Error("MCP_ACCESS_TOKEN contains unsupported characters");
  }
  return value;
}

function requiredHttpsUrl(environment: Environment, name: string): string {
  const value = required(environment, name);

  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    ) {
      return value;
    }
  } catch {
    // Normalize below so URL parser errors cannot echo configuration values.
  }

  throw new Error(`${name} must be an HTTPS URL`);
}

function parseNumericConfiguration(name: string, value: string): number {
  if (!/^(?:0|[1-9]\d*|-[1-9]\d*)$/.test(value)) {
    throw new Error(`Invalid numeric configuration: ${name}`);
  }

  return Number(value);
}

function parsePort(value: string): number {
  const port = parseNumericConfiguration("PORT", value);
  if (port < 1 || port > 65_535) {
    throw new Error("Invalid numeric configuration: PORT");
  }
  return port;
}

function parsePositiveNumericConfiguration(
  name: string,
  value: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = parseNumericConfiguration(name, value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`Invalid numeric configuration: ${name}`);
  }
  return parsed;
}

function parseListenHost(environment: Environment): string {
  const value = environment["LISTEN_HOST"];
  if (value === undefined) {
    return "0.0.0.0";
  }
  if (value.trim().length === 0) {
    throw new Error("Invalid configuration: LISTEN_HOST");
  }
  return value;
}

function parseBooleanConfiguration(
  name: string,
  value: string | undefined,
): boolean {
  if (value === undefined || value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`Invalid boolean configuration: ${name}`);
}

function parseServicePolicy(environment: Environment): ServicePolicy {
  const entries = POLICY_ENVIRONMENT_FIELDS.flatMap(
    ([environmentName, policyName]) => {
      const value = environment[environmentName];
      return value === undefined
        ? []
        : [
            [
              policyName,
              parseNumericConfiguration(environmentName, value),
            ] as const,
          ];
    },
  );

  return createServicePolicy(Object.fromEntries(entries));
}

function commaSeparated(value: string): readonly string[] {
  return value.split(",").map((entry) => entry.trim());
}

function parseHttpBoundaryConfig(
  environment: Environment,
): Pick<HostedConfig, "allowedHosts" | "allowedOrigins"> {
  const allowedHosts = commaSeparated(required(environment, "ALLOWED_HOSTS"));
  const allowedOrigins = commaSeparated(
    environment["ALLOWED_ORIGINS"] ?? "",
  ).filter((entry) => entry.length > 0);

  try {
    createHttpRequestBoundary({ allowedHosts, allowedOrigins: [] });
  } catch {
    throw new Error("Invalid configuration: ALLOWED_HOSTS");
  }

  try {
    createHttpRequestBoundary({ allowedHosts, allowedOrigins });
  } catch {
    throw new Error("Invalid configuration: ALLOWED_ORIGINS");
  }

  return { allowedHosts, allowedOrigins };
}

export function parseLocalConfig(environment: Environment): LocalConfig {
  const steamApiKey = optionalNonBlank(environment["STEAM_API_KEY"]);
  const steamUser = optionalNonBlank(environment["STEAM_USER"]);

  return {
    mode: "local",
    ...(steamApiKey === undefined ? {} : { steamApiKey }),
    ...(steamUser === undefined ? {} : { steamUser }),
    policy: parseServicePolicy(environment),
  };
}

export function parseHostedConfig(environment: Environment): HostedConfig {
  if (optionalNonBlank(environment["STEAM_USER"]) !== undefined) {
    throw new Error("STEAM_USER is not allowed in hosted mode");
  }

  const boundary = parseHttpBoundaryConfig(environment);
  const resourceUri = requiredHttpsUrl(environment, "MCP_RESOURCE_URI");
  if (
    !createHttpRequestBoundary(boundary).check(
      new Headers({ host: new URL(resourceUri).host }),
    ).allowed
  ) {
    throw new Error("MCP_RESOURCE_URI host must be allowed");
  }

  return {
    mode: "hosted",
    steamApiKey: required(environment, "STEAM_API_KEY"),
    accessToken: requiredAccessToken(environment),
    resourceUri,
    ...boundary,
    listenHost: parseListenHost(environment),
    port: parsePort(environment["PORT"] ?? "3000"),
    shutdownDrainTimeoutMs: parsePositiveNumericConfiguration(
      "SHUTDOWN_DRAIN_TIMEOUT_MS",
      environment["SHUTDOWN_DRAIN_TIMEOUT_MS"] ?? "10000",
      60_000,
    ),
    bestEffortWishlistEnabled: parseBooleanConfiguration(
      "STEAM_BEST_EFFORT_WISHLIST_ENABLED",
      environment["STEAM_BEST_EFFORT_WISHLIST_ENABLED"],
    ),
    bestEffortStoreSearchEnabled: parseBooleanConfiguration(
      "STEAM_BEST_EFFORT_STORE_SEARCH_ENABLED",
      environment["STEAM_BEST_EFFORT_STORE_SEARCH_ENABLED"],
    ),
    bestEffortStoreDetailsEnabled: parseBooleanConfiguration(
      "STEAM_BEST_EFFORT_STORE_DETAILS_ENABLED",
      environment["STEAM_BEST_EFFORT_STORE_DETAILS_ENABLED"],
    ),
    bestEffortDeckCompatibilityEnabled: parseBooleanConfiguration(
      "STEAM_BEST_EFFORT_DECK_COMPATIBILITY_ENABLED",
      environment["STEAM_BEST_EFFORT_DECK_COMPATIBILITY_ENABLED"],
    ),
    bestEffortGameReviewsEnabled: parseBooleanConfiguration(
      "STEAM_BEST_EFFORT_GAME_REVIEWS_ENABLED",
      environment["STEAM_BEST_EFFORT_GAME_REVIEWS_ENABLED"],
    ),
    policy: parseServicePolicy(environment),
  };
}
