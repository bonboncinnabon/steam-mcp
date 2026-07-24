import { describe, expect, it, vi } from "vitest";

import { parseSteamId64 } from "../../../src/domain/steam-id.js";
import {
  createSteamIdentityResolver,
  type ResolveSteamIdentityInput,
} from "../../../src/application/services/steam-identity-resolver.js";

describe("Steam identity resolver", () => {
  it("uses an explicit SteamID64 before the local default", async () => {
    const resolveVanityName = vi.fn();
    const resolver = createSteamIdentityResolver({
      steamIdentities: { resolveVanityName },
    });

    await expect(
      resolver.resolve(
        {
          explicitUser: "76561198000000001",
          configuredDefault: "76561198000000002",
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      steamId: parseSteamId64("76561198000000001"),
      source: "explicit",
    });
    expect(resolveVanityName).not.toHaveBeenCalled();
  });

  it("resolves an explicit vanity reference before reading defaults", async () => {
    const resolveVanityName = vi
      .fn()
      .mockResolvedValue(parseSteamId64("76561198000000003"));
    const resolver = createSteamIdentityResolver({
      steamIdentities: { resolveVanityName },
    });
    const signal = new AbortController().signal;

    await expect(
      resolver.resolve({ explicitUser: "portal_fan" }, signal),
    ).resolves.toEqual({
      steamId: "76561198000000003",
      source: "explicit",
    });
    expect(resolveVanityName).toHaveBeenCalledWith("portal_fan", signal);
  });

  it("never treats a remote access token as a Steam identity", async () => {
    const resolveVanityName = vi.fn();
    const resolver = createSteamIdentityResolver({
      steamIdentities: { resolveVanityName },
    });

    const credentialShapedInput = {
      authorizationToken: "remote-access-token",
    } as unknown as ResolveSteamIdentityInput;

    await expect(
      resolver.resolve(credentialShapedInput, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "IDENTITY_NOT_LINKED",
      retryable: false,
    });
    expect(resolveVanityName).not.toHaveBeenCalled();
  });

  it("uses the local default when an explicit user is absent", async () => {
    const resolveVanityName = vi
      .fn()
      .mockResolvedValue(parseSteamId64("76561198000000006"));
    const resolver = createSteamIdentityResolver({
      steamIdentities: { resolveVanityName },
    });
    const signal = new AbortController().signal;

    await expect(
      resolver.resolve({ configuredDefault: "local_vanity" }, signal),
    ).resolves.toEqual({
      steamId: "76561198000000006",
      source: "configured_default",
    });
    expect(resolveVanityName).toHaveBeenCalledExactlyOnceWith(
      "local_vanity",
      signal,
    );
  });

  it("returns corrective IDENTITY_NOT_LINKED without any Steam work", async () => {
    const resolveVanityName = vi.fn();
    const resolver = createSteamIdentityResolver({
      steamIdentities: { resolveVanityName },
    });

    await expect(
      resolver.resolve({}, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "IDENTITY_NOT_LINKED",
      retryable: false,
      message: "Provide a Steam user, or configure STEAM_USER",
    });
    expect(resolveVanityName).not.toHaveBeenCalled();
  });

  it("does not fall back when an explicit vanity user is not found", async () => {
    const resolveVanityName = vi.fn().mockResolvedValue(undefined);
    const resolver = createSteamIdentityResolver({
      steamIdentities: { resolveVanityName },
    });

    await expect(
      resolver.resolve(
        {
          explicitUser: "missing_vanity",
          configuredDefault: "76561198000000008",
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", retryable: false });
  });

  it("uses a local SteamID64 without an upstream vanity lookup", async () => {
    const resolveVanityName = vi.fn();
    const resolver = createSteamIdentityResolver({
      steamIdentities: { resolveVanityName },
    });

    await expect(
      resolver.resolve(
        { configuredDefault: "76561198000000010" },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      steamId: "76561198000000010",
      source: "configured_default",
    });
    expect(resolveVanityName).not.toHaveBeenCalled();
  });

  it("reports a configured local vanity that no longer resolves", async () => {
    const resolver = createSteamIdentityResolver({
      steamIdentities: {
        resolveVanityName: vi.fn().mockResolvedValue(undefined),
      },
    });

    await expect(
      resolver.resolve(
        { configuredDefault: "missing_local" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      retryable: false,
      message: "The configured default Steam user was not found",
    });
  });
});
