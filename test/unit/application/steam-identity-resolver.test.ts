import { describe, expect, it, vi } from "vitest";

import { parseSteamId64 } from "../../../src/domain/steam-id.js";
import { createSteamIdentityResolver } from "../../../src/application/services/steam-identity-resolver.js";

describe("Steam identity resolver", () => {
  it("uses an explicit SteamID64 without reading or mutating the linked default", async () => {
    const getLinkedSteamId = vi.fn();
    const resolveVanityName = vi.fn();
    const resolver = createSteamIdentityResolver({
      linkedIdentities: { getLinkedSteamId },
      steamIdentities: { resolveVanityName },
    });

    await expect(
      resolver.resolve(
        {
          explicitUser: "76561198000000001",
          subject: "tenant-safe-subject",
          localDefault: "76561198000000002",
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      steamId: parseSteamId64("76561198000000001"),
      source: "explicit",
    });
    expect(getLinkedSteamId).not.toHaveBeenCalled();
    expect(resolveVanityName).not.toHaveBeenCalled();
  });

  it("resolves an explicit vanity reference before reading defaults", async () => {
    const getLinkedSteamId = vi.fn();
    const resolveVanityName = vi
      .fn()
      .mockResolvedValue(parseSteamId64("76561198000000003"));
    const resolver = createSteamIdentityResolver({
      linkedIdentities: { getLinkedSteamId },
      steamIdentities: { resolveVanityName },
    });
    const signal = new AbortController().signal;

    await expect(
      resolver.resolve(
        { explicitUser: "portal_fan", subject: "hosted-subject" },
        signal,
      ),
    ).resolves.toEqual({
      steamId: "76561198000000003",
      source: "explicit",
    });
    expect(resolveVanityName).toHaveBeenCalledWith("portal_fan", signal);
    expect(getLinkedSteamId).not.toHaveBeenCalled();
  });

  it("uses the exact authenticated subject's linked Steam identity", async () => {
    const getLinkedSteamId = vi
      .fn()
      .mockResolvedValue(parseSteamId64("76561198000000004"));
    const resolveVanityName = vi.fn();
    const resolver = createSteamIdentityResolver({
      linkedIdentities: { getLinkedSteamId },
      steamIdentities: { resolveVanityName },
    });

    await expect(
      resolver.resolve(
        {
          subject: "issuer-scoped-subject",
          localDefault: "76561198000000005",
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      steamId: "76561198000000004",
      source: "linked",
    });
    expect(getLinkedSteamId).toHaveBeenCalledExactlyOnceWith(
      "issuer-scoped-subject",
    );
    expect(resolveVanityName).not.toHaveBeenCalled();
  });

  it("uses the local default only after an absent hosted link", async () => {
    const getLinkedSteamId = vi.fn().mockResolvedValue(undefined);
    const resolveVanityName = vi
      .fn()
      .mockResolvedValue(parseSteamId64("76561198000000006"));
    const resolver = createSteamIdentityResolver({
      linkedIdentities: { getLinkedSteamId },
      steamIdentities: { resolveVanityName },
    });
    const signal = new AbortController().signal;

    await expect(
      resolver.resolve(
        { subject: "unlinked-subject", localDefault: "local_vanity" },
        signal,
      ),
    ).resolves.toEqual({
      steamId: "76561198000000006",
      source: "local_default",
    });
    expect(getLinkedSteamId).toHaveBeenCalledExactlyOnceWith(
      "unlinked-subject",
    );
    expect(resolveVanityName).toHaveBeenCalledExactlyOnceWith(
      "local_vanity",
      signal,
    );
  });

  it("returns corrective IDENTITY_NOT_LINKED without any Steam work", async () => {
    const getLinkedSteamId = vi.fn();
    const resolveVanityName = vi.fn();
    const resolver = createSteamIdentityResolver({
      linkedIdentities: { getLinkedSteamId },
      steamIdentities: { resolveVanityName },
    });

    await expect(
      resolver.resolve({}, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "IDENTITY_NOT_LINKED",
      retryable: false,
      message: "Provide a Steam user or link a default Steam identity",
    });
    expect(getLinkedSteamId).not.toHaveBeenCalled();
    expect(resolveVanityName).not.toHaveBeenCalled();
  });

  it("does not fall back when an explicit vanity user is not found", async () => {
    const getLinkedSteamId = vi
      .fn()
      .mockResolvedValue(parseSteamId64("76561198000000007"));
    const resolveVanityName = vi.fn().mockResolvedValue(undefined);
    const resolver = createSteamIdentityResolver({
      linkedIdentities: { getLinkedSteamId },
      steamIdentities: { resolveVanityName },
    });

    await expect(
      resolver.resolve(
        {
          explicitUser: "missing_vanity",
          subject: "linked-subject",
          localDefault: "76561198000000008",
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", retryable: false });
    expect(getLinkedSteamId).not.toHaveBeenCalled();
  });

  it("does not cross into a local default when the linked-identity read fails", async () => {
    const repositoryFailure = new Error("synthetic repository outage");
    const getLinkedSteamId = vi.fn().mockRejectedValue(repositoryFailure);
    const resolveVanityName = vi.fn();
    const resolver = createSteamIdentityResolver({
      linkedIdentities: { getLinkedSteamId },
      steamIdentities: { resolveVanityName },
    });

    await expect(
      resolver.resolve(
        {
          subject: "hosted-subject",
          localDefault: "76561198000000009",
        },
        new AbortController().signal,
      ),
    ).rejects.toBe(repositoryFailure);
    expect(resolveVanityName).not.toHaveBeenCalled();
  });

  it("uses a local SteamID64 without an upstream vanity lookup", async () => {
    const getLinkedSteamId = vi.fn();
    const resolveVanityName = vi.fn();
    const resolver = createSteamIdentityResolver({
      linkedIdentities: { getLinkedSteamId },
      steamIdentities: { resolveVanityName },
    });

    await expect(
      resolver.resolve(
        { localDefault: "76561198000000010" },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      steamId: "76561198000000010",
      source: "local_default",
    });
    expect(resolveVanityName).not.toHaveBeenCalled();
  });

  it("reports a configured local vanity that no longer resolves", async () => {
    const resolver = createSteamIdentityResolver({
      linkedIdentities: { getLinkedSteamId: vi.fn() },
      steamIdentities: {
        resolveVanityName: vi.fn().mockResolvedValue(undefined),
      },
    });

    await expect(
      resolver.resolve(
        { localDefault: "missing_local" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      retryable: false,
      message: "The configured default Steam user was not found",
    });
  });
});
