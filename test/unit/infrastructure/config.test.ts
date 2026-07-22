import { describe, expect, it } from "vitest";

import { BASELINE_SERVICE_POLICY } from "../../../src/domain/service-policy.js";
import {
  parseHostedConfig,
  parseLocalConfig,
} from "../../../src/infrastructure/config.js";

const BASELINE_HOSTED_ENVIRONMENT = {
  STEAM_API_KEY: "synthetic-hosted-value",
  MCP_ACCESS_TOKEN: "synthetic-remote-access-token-value",
  MCP_RESOURCE_URI: "https://steam.example/mcp",
  ALLOWED_HOSTS: "steam.example",
} as const;

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
  it("rejects a remote bearer token shorter than 32 characters", () => {
    expect(() =>
      parseHostedConfig({
        ...BASELINE_HOSTED_ENVIRONMENT,
        MCP_ACCESS_TOKEN: "short-private-sentinel",
      }),
    ).toThrow("MCP_ACCESS_TOKEN must contain at least 32 characters");
  });

  it("rejects a remote bearer token that cannot be represented in one header", () => {
    expect(() =>
      parseHostedConfig({
        ...BASELINE_HOSTED_ENVIRONMENT,
        MCP_ACCESS_TOKEN: "synthetic remote access token value",
      }),
    ).toThrow("MCP_ACCESS_TOKEN contains unsupported characters");
  });

  it("starts hosted mode without account or distributed quota storage", () => {
    expect(
      parseHostedConfig({
        ...BASELINE_HOSTED_ENVIRONMENT,
        STEAM_API_KEY: "synthetic-hosted-value",
        MCP_ACCESS_TOKEN: "synthetic-remote-access-token-value",
        MCP_RESOURCE_URI: "https://steam.example/mcp",
        ALLOWED_HOSTS: "steam.example,steam.example:8443",
        ALLOWED_ORIGINS: "https://chatgpt.com, https://claude.ai",
      }),
    ).toEqual({
      mode: "hosted",
      steamApiKey: "synthetic-hosted-value",
      accessToken: "synthetic-remote-access-token-value",
      resourceUri: "https://steam.example/mcp",
      allowedHosts: ["steam.example", "steam.example:8443"],
      allowedOrigins: ["https://chatgpt.com", "https://claude.ai"],
      listenHost: "0.0.0.0",
      port: 3000,
      shutdownDrainTimeoutMs: 10_000,
      bestEffortWishlistEnabled: true,
      bestEffortStoreSearchEnabled: true,
      bestEffortStoreDetailsEnabled: true,
      bestEffortDeckCompatibilityEnabled: true,
      bestEffortGameReviewsEnabled: true,
      policy: BASELINE_SERVICE_POLICY,
    });
  });

  it("reports each missing required field without echoing values", () => {
    const environment = {
      ...BASELINE_HOSTED_ENVIRONMENT,
      STEAM_API_KEY: "synthetic-hosted-value",
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
        ...BASELINE_HOSTED_ENVIRONMENT,
        STEAM_API_KEY: "   ",
        MCP_RESOURCE_URI: "https://steam.example/mcp",
      }),
    ).toThrow("Missing required configuration: STEAM_API_KEY");
  });

  it("requires HTTPS for public hosted URLs", () => {
    const environment = {
      ...BASELINE_HOSTED_ENVIRONMENT,
      STEAM_API_KEY: "synthetic-hosted-value",
      MCP_RESOURCE_URI: "https://steam.example/mcp",
    };
    const insecureFields = ["MCP_RESOURCE_URI"] as const;

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

  it("rejects hosted URLs that embed credentials or fragments", () => {
    const fields = ["MCP_RESOURCE_URI"] as const;
    const messages = fields.flatMap((field) =>
      [
        "https://user:secret@identity.example/path",
        "https://identity.example/path#private-fragment",
      ].map((value) => {
        try {
          parseHostedConfig({ ...BASELINE_HOSTED_ENVIRONMENT, [field]: value });
          return "no error";
        } catch (error) {
          return error instanceof Error ? error.message : "unknown error";
        }
      }),
    );

    expect(messages).toEqual(
      fields.flatMap((field) => [
        `${field} must be an HTTPS URL`,
        `${field} must be an HTTPS URL`,
      ]),
    );
  });

  it("sanitizes a malformed public URL diagnostic", () => {
    expect(() =>
      parseHostedConfig({
        ...BASELINE_HOSTED_ENVIRONMENT,
        STEAM_API_KEY: "synthetic-hosted-value",
        MCP_RESOURCE_URI: "malformed-sentinel-value",
      }),
    ).toThrow("MCP_RESOURCE_URI must be an HTTPS URL");
  });

  it("rejects malformed allowed hosts without echoing their values", () => {
    expect(() =>
      parseHostedConfig({
        ...BASELINE_HOSTED_ENVIRONMENT,
        ALLOWED_HOSTS: "steam.example/private-sentinel",
      }),
    ).toThrow("Invalid configuration: ALLOWED_HOSTS");
  });

  it("requires the canonical resource host in the ingress allowlist", () => {
    expect(() =>
      parseHostedConfig({
        ...BASELINE_HOSTED_ENVIRONMENT,
        ALLOWED_HOSTS: "other.example",
      }),
    ).toThrow("MCP_RESOURCE_URI host must be allowed");
  });

  it("rejects malformed allowed origins without echoing their values", () => {
    expect(() =>
      parseHostedConfig({
        ...BASELINE_HOSTED_ENVIRONMENT,
        ALLOWED_ORIGINS: "http://origin-sentinel.example",
      }),
    ).toThrow("Invalid configuration: ALLOWED_ORIGINS");
  });

  it("can independently disable every runtime best-effort adapter", () => {
    const config = parseHostedConfig({
      ...BASELINE_HOSTED_ENVIRONMENT,
      STEAM_BEST_EFFORT_WISHLIST_ENABLED: "false",
      STEAM_BEST_EFFORT_STORE_SEARCH_ENABLED: "false",
      STEAM_BEST_EFFORT_STORE_DETAILS_ENABLED: "false",
      STEAM_BEST_EFFORT_DECK_COMPATIBILITY_ENABLED: "false",
      STEAM_BEST_EFFORT_GAME_REVIEWS_ENABLED: "false",
    });

    expect({
      wishlist: config.bestEffortWishlistEnabled,
      storeSearch: config.bestEffortStoreSearchEnabled,
      storeDetails: config.bestEffortStoreDetailsEnabled,
      deckCompatibility: config.bestEffortDeckCompatibilityEnabled,
      gameReviews: config.bestEffortGameReviewsEnabled,
    }).toEqual({
      wishlist: false,
      storeSearch: false,
      storeDetails: false,
      deckCompatibility: false,
      gameReviews: false,
    });
  });

  it("rejects non-boolean best-effort switches without echoing values", () => {
    const fields = [
      "STEAM_BEST_EFFORT_WISHLIST_ENABLED",
      "STEAM_BEST_EFFORT_STORE_SEARCH_ENABLED",
      "STEAM_BEST_EFFORT_STORE_DETAILS_ENABLED",
      "STEAM_BEST_EFFORT_DECK_COMPATIBILITY_ENABLED",
      "STEAM_BEST_EFFORT_GAME_REVIEWS_ENABLED",
    ] as const;

    const messages = fields.map((field) => {
      try {
        parseHostedConfig({
          ...BASELINE_HOSTED_ENVIRONMENT,
          [field]: "malformed-sentinel-value",
        });
        return "no error";
      } catch (error) {
        return error instanceof Error ? error.message : "unknown error";
      }
    });

    expect(messages).toEqual(
      fields.map((field) => `Invalid boolean configuration: ${field}`),
    );
  });

  it("requires the listen port to be in the TCP port range", () => {
    const messages = ["0", "65536"].map((port) => {
      try {
        parseHostedConfig({ ...BASELINE_HOSTED_ENVIRONMENT, PORT: port });
        return "no error";
      } catch (error) {
        return error instanceof Error ? error.message : "unknown error";
      }
    });

    expect(messages).toEqual([
      "Invalid numeric configuration: PORT",
      "Invalid numeric configuration: PORT",
    ]);
  });

  it("requires a positive shutdown drain timeout", () => {
    expect(() =>
      parseHostedConfig({
        ...BASELINE_HOSTED_ENVIRONMENT,
        SHUTDOWN_DRAIN_TIMEOUT_MS: "0",
      }),
    ).toThrow("Invalid numeric configuration: SHUTDOWN_DRAIN_TIMEOUT_MS");
  });

  it("caps shutdown draining at the hosted lifecycle maximum", () => {
    expect(() =>
      parseHostedConfig({
        ...BASELINE_HOSTED_ENVIRONMENT,
        SHUTDOWN_DRAIN_TIMEOUT_MS: "60001",
      }),
    ).toThrow("Invalid numeric configuration: SHUTDOWN_DRAIN_TIMEOUT_MS");
  });

  it("rejects a shutdown drain timeout outside the safe integer range", () => {
    expect(() =>
      parseHostedConfig({
        ...BASELINE_HOSTED_ENVIRONMENT,
        SHUTDOWN_DRAIN_TIMEOUT_MS: "999999999999999999999999999999999999",
      }),
    ).toThrow("Invalid numeric configuration: SHUTDOWN_DRAIN_TIMEOUT_MS");
  });

  it("rejects an explicitly blank listen host", () => {
    expect(() =>
      parseHostedConfig({
        ...BASELINE_HOSTED_ENVIRONMENT,
        LISTEN_HOST: "   ",
      }),
    ).toThrow("Invalid configuration: LISTEN_HOST");
  });

  it("reads explicit hosted listener and drain settings", () => {
    const config = parseHostedConfig({
      ...BASELINE_HOSTED_ENVIRONMENT,
      LISTEN_HOST: "::",
      PORT: "8443",
      SHUTDOWN_DRAIN_TIMEOUT_MS: "25000",
    });

    expect({
      listenHost: config.listenHost,
      port: config.port,
      shutdownDrainTimeoutMs: config.shutdownDrainTimeoutMs,
      allowedOrigins: config.allowedOrigins,
    }).toEqual({
      listenHost: "::",
      port: 8443,
      shutdownDrainTimeoutMs: 25_000,
      allowedOrigins: [],
    });
  });

  it("uses the baseline service policy when overrides are absent", () => {
    const config = parseHostedConfig({
      ...BASELINE_HOSTED_ENVIRONMENT,
      STEAM_API_KEY: "synthetic-hosted-value",
      MCP_RESOURCE_URI: "https://steam.example/mcp",
    });

    expect(config.policy).toEqual(BASELINE_SERVICE_POLICY);
  });

  it("parses every supported numeric policy override", () => {
    const config = parseHostedConfig({
      ...BASELINE_HOSTED_ENVIRONMENT,
      STEAM_API_KEY: "synthetic-hosted-value",
      MCP_RESOURCE_URI: "https://steam.example/mcp",
      UPSTREAM_TIMEOUT_MS: "7000",
      MAX_RETRY_ATTEMPTS: "3",
      GLOBAL_DAILY_QUOTA: "90000",
      GLOBAL_SAFETY_RESERVE: "10000",
      MAX_HOST_CONCURRENCY: "10",
      MAX_OPERATION_CONCURRENCY: "5",
      MAX_CONCURRENCY_QUEUE_SIZE: "72",
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
      maxHostConcurrency: 10,
      maxOperationConcurrency: 5,
      maxConcurrencyQueueSize: 72,
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
        ...BASELINE_HOSTED_ENVIRONMENT,
        STEAM_API_KEY: "synthetic-hosted-value",
        MCP_RESOURCE_URI: "https://steam.example/mcp",
        MAX_RETRY_ATTEMPTS: "malformed-sentinel-value",
      }),
    ).toThrow("Invalid numeric configuration: MAX_RETRY_ATTEMPTS");
  });

  it("rejects a process-wide Steam user in hosted mode", () => {
    expect(() =>
      parseHostedConfig({
        ...BASELINE_HOSTED_ENVIRONMENT,
        STEAM_API_KEY: "synthetic-hosted-value",
        STEAM_USER: "unsafe-process-default",
        MCP_RESOURCE_URI: "https://steam.example/mcp",
      }),
    ).toThrow("STEAM_USER is not allowed in hosted mode");
  });
});
