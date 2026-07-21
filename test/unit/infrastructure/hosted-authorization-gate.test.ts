import { describe, expect, it, vi } from "vitest";

import {
  createHostedAuthorizationGate,
  type HostedAuthorizationGateOptions,
} from "../../../src/infrastructure/hosted-authorization-gate.js";

const resource = {
  resourceUri: "https://steam.example/mcp",
  authorizationServer: "https://login.example",
  scopes: ["steam:read"],
} as const;

function gateWith(
  validation: Awaited<
    ReturnType<HostedAuthorizationGateOptions["validator"]["validate"]>
  >,
) {
  const validate = vi.fn().mockResolvedValue(validation);
  return {
    gate: createHostedAuthorizationGate({ resource, validator: { validate } }),
    validate,
  };
}

describe("createHostedAuthorizationGate", () => {
  it("rejects a missing token before validation or application work", async () => {
    const { gate, validate } = gateWith({
      authorized: false,
      reason: "invalid_token",
    });
    const execute = vi.fn();

    const result = await gate.run({ execute });

    expect(result).toMatchObject({
      authorized: false,
      response: { status: 401 },
    });
    expect(result).toEqual({
      authorized: false,
      response: {
        status: 401,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json",
          "www-authenticate":
            'Bearer resource_metadata="https://steam.example/.well-known/oauth-protected-resource/mcp", scope="steam:read"',
        },
        body: { error: "unauthorized" },
      },
    });
    expect(validate).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(["Basic abc", "Bearer", "Bearer one two", "Bearer\r\nprivate"])(
    "rejects malformed authorization header %j before validation",
    async (authorizationHeader) => {
      const { gate, validate } = gateWith({
        authorized: false,
        reason: "invalid_token",
      });
      const execute = vi.fn();

      const result = await gate.run({ authorizationHeader, execute });

      expect(result).toMatchObject({
        authorized: false,
        response: { status: 401 },
      });
      expect(
        result.authorized
          ? "authorized"
          : result.response.headers["www-authenticate"],
      ).toContain('error="invalid_token"');
      expect(validate).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["invalid_token", 401],
    ["insufficient_scope", 403],
    ["dependency_unavailable", 503],
  ] as const)(
    "performs no application work for %s",
    async (reason, expectedStatus) => {
      const { gate } = gateWith({ authorized: false, reason });
      const quota = vi.fn();
      const tool = vi.fn();
      const steam = vi.fn();
      const execute = vi.fn(() => {
        quota();
        tool();
        steam();
        return Promise.resolve();
      });

      const result = await gate.run({
        authorizationHeader: "Bearer synthetic-private-token",
        execute,
      });

      expect(result).toMatchObject({
        authorized: false,
        response: { status: expectedStatus },
      });
      expect(quota).not.toHaveBeenCalled();
      expect(tool).not.toHaveBeenCalled();
      expect(steam).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("synthetic-private-token");

      if (reason === "dependency_unavailable") {
        expect(result).toEqual({
          authorized: false,
          response: {
            status: 503,
            headers: {
              "cache-control": "no-store",
              "content-type": "application/json",
              "retry-after": "5",
            },
            body: { error: "temporarily_unavailable" },
          },
        });
      }
    },
  );

  it("passes only authorization context and cancellation to downstream work", async () => {
    const { gate, validate } = gateWith({
      authorized: true,
      context: {
        subject: "oauth-user-1",
        scopes: new Set(["steam:read"]),
      },
    });
    const signal = new AbortController().signal;
    const execute = vi.fn().mockResolvedValue("completed");

    const result = await gate.run({
      authorizationHeader: "Bearer synthetic-private-token",
      signal,
      execute,
    });

    expect(validate).toHaveBeenCalledWith("synthetic-private-token", signal);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      {
        subject: "oauth-user-1",
        scopes: new Set(["steam:read"]),
      },
      signal,
    );
    expect(execute.mock.calls[0]).toHaveLength(2);
    expect(result).toEqual({ authorized: true, value: "completed" });
  });
});
