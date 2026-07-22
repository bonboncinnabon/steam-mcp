import { describe, expect, it } from "vitest";

import { createRemoteBearerGate } from "../../../src/infrastructure/remote-bearer-gate.js";

const accessToken = "synthetic-remote-access-token-value";

describe("createRemoteBearerGate", () => {
  it("authorizes only the configured bearer token", () => {
    const gate = createRemoteBearerGate({ accessToken });

    expect(gate.authenticate(`Bearer ${accessToken}`)).toBeUndefined();
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["wrong scheme", `Basic ${accessToken}`],
    ["missing token", "Bearer"],
    ["extra whitespace", `Bearer  ${accessToken}`],
    ["prefixed scheme", `XBearer ${accessToken}`],
    ["trailing whitespace", `Bearer ${accessToken} `],
    ["incorrect token", "Bearer different-remote-access-token-value"],
  ])(
    "returns the same generic rejection for a %s credential",
    (_name, header) => {
      const gate = createRemoteBearerGate({ accessToken });

      expect(gate.authenticate(header)).toEqual({
        status: 401,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json",
          "www-authenticate": "Bearer",
        },
        body: { error: "unauthorized" },
      });
    },
  );

  it("uses the newly configured token after an operator restarts the service", () => {
    const oldToken = "old-synthetic-remote-access-token-value";
    const newToken = "new-synthetic-remote-access-token-value";
    const beforeRestart = createRemoteBearerGate({ accessToken: oldToken });
    const afterRestart = createRemoteBearerGate({ accessToken: newToken });

    expect(beforeRestart.authenticate(`Bearer ${oldToken}`)).toBeUndefined();
    expect(afterRestart.authenticate(`Bearer ${oldToken}`)).toBeDefined();
    expect(afterRestart.authenticate(`Bearer ${newToken}`)).toBeUndefined();
  });
});
