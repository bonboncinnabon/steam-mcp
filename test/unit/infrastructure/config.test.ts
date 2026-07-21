import { describe, expect, it } from "vitest";

import { BASELINE_SERVICE_POLICY } from "../../../src/domain/service-policy.js";
import {
  parseHostedConfig,
  parseLocalConfig,
} from "../../../src/infrastructure/config.js";

describe("parseLocalConfig", () => {
  it("reads the local Steam credential and optional default user", () => {
    expect(
      parseLocalConfig({
        STEAM_API_KEY: "synthetic-test-value",
        STEAM_USER: "example-vanity",
      }),
    ).toMatchObject({
      mode: "local",
      steamApiKey: "synthetic-test-value",
      steamUser: "example-vanity",
    });
  });

  it("keeps missing optional local values absent", () => {
    const config = parseLocalConfig({});

    expect({
      steamApiKey: "steamApiKey" in config,
      steamUser: "steamUser" in config,
    }).toEqual({ steamApiKey: false, steamUser: false });
  });

  it("uses the common validated service policy", () => {
    expect(parseLocalConfig({ MAX_PAGE_SIZE: "50" }).policy.maxPageSize).toBe(
      50,
    );
  });

  it("treats blank optional local values as absent", () => {
    const config = parseLocalConfig({ STEAM_API_KEY: " ", STEAM_USER: "\t" });

    expect({
      steamApiKey: "steamApiKey" in config,
      steamUser: "steamUser" in config,
    }).toEqual({ steamApiKey: false, steamUser: false });
  });
});

describe("parseHostedConfig", () => {
  it("starts hosted mode without account or distributed quota storage", () => {
    expect(
      parseHostedConfig({
        STEAM_API_KEY: "synthetic-hosted-value",
        OAUTH_ISSUER: "https://identity.example",
        MCP_RESOURCE_URI: "https://steam.example/mcp",
      }),
    ).toEqual({
      mode: "hosted",
      steamApiKey: "synthetic-hosted-value",
      oauthIssuer: "https://identity.example",
      resourceUri: "https://steam.example/mcp",
      policy: BASELINE_SERVICE_POLICY,
    });
  });

  it("reports each missing required field without echoing values", () => {
    const environment = {
      STEAM_API_KEY: "synthetic-hosted-value",
      OAUTH_ISSUER: "https://identity.example",
      MCP_RESOURCE_URI: "https://steam.example/mcp",
    };
    const requiredFields = Object.keys(
      environment,
    ) as (keyof typeof environment)[];

    const messages = requiredFields.map((field) => {
      try {
        parseHostedConfig({ ...environment, [field]: undefined });
        return "no error";
      } catch (error) {
        return error instanceof Error ? error.message : "unknown error";
      }
    });

    expect(messages).toEqual(
      requiredFields.map((field) => `Missing required configuration: ${field}`),
    );
  });

  it("rejects a blank required hosted value", () => {
    expect(() =>
      parseHostedConfig({
        STEAM_API_KEY: "   ",
        OAUTH_ISSUER: "https://identity.example",
        MCP_RESOURCE_URI: "https://steam.example/mcp",
      }),
    ).toThrow("Missing required configuration: STEAM_API_KEY");
  });

  it("requires HTTPS for public hosted URLs", () => {
    const environment = {
      STEAM_API_KEY: "synthetic-hosted-value",
      OAUTH_ISSUER: "https://identity.example",
      MCP_RESOURCE_URI: "https://steam.example/mcp",
    };
    const insecureFields = ["OAUTH_ISSUER", "MCP_RESOURCE_URI"] as const;

    const messages = insecureFields.map((field) => {
      try {
        parseHostedConfig({
          ...environment,
          [field]: "http://insecure.example",
        });
        return "no error";
      } catch (error) {
        return error instanceof Error ? error.message : "unknown error";
      }
    });

    expect(messages).toEqual(
      insecureFields.map((field) => `${field} must be an HTTPS URL`),
    );
  });

  it("sanitizes a malformed public URL diagnostic", () => {
    expect(() =>
      parseHostedConfig({
        STEAM_API_KEY: "synthetic-hosted-value",
        OAUTH_ISSUER: "malformed-sentinel-value",
        MCP_RESOURCE_URI: "https://steam.example/mcp",
      }),
    ).toThrow("OAUTH_ISSUER must be an HTTPS URL");
  });

  it("uses the baseline service policy when overrides are absent", () => {
    const config = parseHostedConfig({
      STEAM_API_KEY: "synthetic-hosted-value",
      OAUTH_ISSUER: "https://identity.example",
      MCP_RESOURCE_URI: "https://steam.example/mcp",
    });

    expect(config.policy).toEqual(BASELINE_SERVICE_POLICY);
  });

  it("parses every supported numeric policy override", () => {
    const config = parseHostedConfig({
      STEAM_API_KEY: "synthetic-hosted-value",
      OAUTH_ISSUER: "https://identity.example",
      MCP_RESOURCE_URI: "https://steam.example/mcp",
      UPSTREAM_TIMEOUT_MS: "7000",
      MAX_RETRY_ATTEMPTS: "3",
      GLOBAL_DAILY_QUOTA: "90000",
      GLOBAL_SAFETY_RESERVE: "10000",
      PER_USER_DAILY_QUOTA: "600",
      MAX_HOST_CONCURRENCY: "10",
      MAX_OPERATION_CONCURRENCY: "5",
      MAX_TOOL_FAN_OUT: "25",
      DEFAULT_PAGE_SIZE: "25",
      MAX_PAGE_SIZE: "125",
      EXECUTION_DEADLINE_MS: "35000",
      MAX_OUTPUT_BYTES: "300000",
    });

    expect(config.policy).toEqual({
      upstreamTimeoutMs: 7_000,
      maxRetryAttempts: 3,
      globalDailyQuota: 90_000,
      globalSafetyReserve: 10_000,
      perUserDailyQuota: 600,
      maxHostConcurrency: 10,
      maxOperationConcurrency: 5,
      maxToolFanOut: 25,
      defaultPageSize: 25,
      maxPageSize: 125,
      executionDeadlineMs: 35_000,
      maxOutputBytes: 300_000,
    });
  });

  it("sanitizes a malformed numeric override diagnostic", () => {
    expect(() =>
      parseHostedConfig({
        STEAM_API_KEY: "synthetic-hosted-value",
        OAUTH_ISSUER: "https://identity.example",
        MCP_RESOURCE_URI: "https://steam.example/mcp",
        MAX_RETRY_ATTEMPTS: "malformed-sentinel-value",
      }),
    ).toThrow("Invalid numeric configuration: MAX_RETRY_ATTEMPTS");
  });

  it("rejects a process-wide Steam user in hosted mode", () => {
    expect(() =>
      parseHostedConfig({
        STEAM_API_KEY: "synthetic-hosted-value",
        STEAM_USER: "unsafe-process-default",
        OAUTH_ISSUER: "https://identity.example",
        MCP_RESOURCE_URI: "https://steam.example/mcp",
      }),
    ).toThrow("STEAM_USER is not allowed in hosted mode");
  });
});
