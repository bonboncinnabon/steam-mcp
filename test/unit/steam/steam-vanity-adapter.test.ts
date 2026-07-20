import { describe, expect, it, vi } from "vitest";

import {
  createSteamVanityAdapter,
  type SteamVanityHttpExecutor,
} from "../../../src/steam/adapters/steam-vanity-adapter.js";
import { SteamUpstreamError } from "../../../src/steam/http/steam-retry-policy.js";

describe("Steam vanity adapter", () => {
  it("resolves a documented vanity response to an exact SteamID64", async () => {
    const execute = vi.fn<SteamVanityHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        '{"response":{"steamid":"76561198000000000","success":1}}',
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/",
    });
    const adapter = createSteamVanityAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });
    const signal = new AbortController().signal;

    await expect(adapter.resolveVanityName("portal_fan", signal)).resolves.toBe(
      "76561198000000000",
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      method: "GET",
      redirect: "manual",
    });
    expect(execute.mock.calls[0]?.[0].url).toContain("vanityurl=portal_fan");
    expect(execute.mock.calls[0]?.[1]).toBe(signal);
  });

  it("maps Steam's documented no-match response to not found", async () => {
    const execute = vi.fn<SteamVanityHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        '{"response":{"success":42,"message":"No match"}}',
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/",
    });
    const adapter = createSteamVanityAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.resolveVanityName("missing_user", new AbortController().signal),
    ).resolves.toBeUndefined();
  });

  it("rejects a success response containing a malformed SteamID64", async () => {
    const execute = vi.fn<SteamVanityHttpExecutor>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(
        '{"response":{"steamid":"not-an-id","success":1}}',
      ),
      finalUrl:
        "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/",
    });
    const adapter = createSteamVanityAdapter({
      apiKey: "synthetic-api-key",
      execute,
    });

    await expect(
      adapter.resolveVanityName("bad_response", new AbortController().signal),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      kind: "invalid_shape",
    });
  });

  it("preserves deterministic auth, rate-limit, and unavailable mappings", async () => {
    for (const decision of [
      { code: "STEAM_AUTH_FAILED" as const, retryable: false },
      { code: "STEAM_RATE_LIMITED" as const, retryable: true },
      { code: "UPSTREAM_UNAVAILABLE" as const, retryable: true },
    ]) {
      const upstreamError = new SteamUpstreamError(decision);
      const execute = vi
        .fn<SteamVanityHttpExecutor>()
        .mockRejectedValue(upstreamError);
      const adapter = createSteamVanityAdapter({
        apiKey: "synthetic-api-key",
        execute,
      });

      await expect(
        adapter.resolveVanityName("portal_fan", new AbortController().signal),
      ).rejects.toBe(upstreamError);
    }
  });
});
