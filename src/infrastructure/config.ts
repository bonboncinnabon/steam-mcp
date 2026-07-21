import { URL } from "node:url";

import {
  createServicePolicy,
  type ServicePolicy,
} from "../domain/service-policy.js";

export interface LocalConfig {
  readonly mode: "local";
  readonly steamApiKey?: string;
  readonly steamUser?: string;
  readonly policy: ServicePolicy;
}

export interface HostedConfig {
  readonly mode: "hosted";
  readonly steamApiKey: string;
  readonly oauthIssuer: string;
  readonly resourceUri: string;
  readonly policy: ServicePolicy;
}

type Environment = Readonly<Record<string, string | undefined>>;

const POLICY_ENVIRONMENT_FIELDS = [
  ["UPSTREAM_TIMEOUT_MS", "upstreamTimeoutMs"],
  ["MAX_RETRY_ATTEMPTS", "maxRetryAttempts"],
  ["GLOBAL_DAILY_QUOTA", "globalDailyQuota"],
  ["GLOBAL_SAFETY_RESERVE", "globalSafetyReserve"],
  ["PER_USER_DAILY_QUOTA", "perUserDailyQuota"],
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

function requiredHttpsUrl(environment: Environment, name: string): string {
  const value = required(environment, name);

  try {
    if (new URL(value).protocol === "https:") {
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

  return {
    mode: "hosted",
    steamApiKey: required(environment, "STEAM_API_KEY"),
    oauthIssuer: requiredHttpsUrl(environment, "OAUTH_ISSUER"),
    resourceUri: requiredHttpsUrl(environment, "MCP_RESOURCE_URI"),
    policy: parseServicePolicy(environment),
  };
}
