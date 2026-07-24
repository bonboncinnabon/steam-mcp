import { describe, expect, it, vi } from "vitest";

import { parseSteamId64 } from "../../../src/domain/steam-id.js";
import { createSteamGetPlayerService } from "../../../src/application/services/steam-get-player.js";
import { SteamIdentityResolutionError } from "../../../src/application/services/steam-identity-resolver.js";

describe("steam_get_player application service", () => {
  it("returns normalized public profile and ban facets in the v1 envelope", async () => {
    const steamId = parseSteamId64("76561198000000000");
    const resolve = vi.fn().mockResolvedValue({
      steamId,
      source: "explicit",
    });
    const getPlayers = vi.fn().mockResolvedValue([
      {
        steamId,
        displayName: "Synthetic Player",
        profileUrl: "https://steamcommunity.com/profiles/synthetic",
        avatarUrl: "https://cdn.example.invalid/avatar.jpg",
        visibility: "public",
        onlineState: "online",
        currentAppId: 620,
      },
    ]);
    const getPlayerBans = vi.fn().mockResolvedValue([
      {
        steamId,
        communityBanned: false,
        vacBanCount: 0,
        gameBanCount: 0,
        economyBan: "none",
      },
    ]);
    const service = createSteamGetPlayerService({
      identityResolver: { resolve },
      steamData: { getPlayers, getPlayerBans },
    });
    const signal = new AbortController().signal;

    await expect(
      service.execute({ explicitUser: steamId }, signal),
    ).resolves.toEqual({
      ok: true,
      data: {
        steamId,
        profile: {
          steamId,
          displayName: "Synthetic Player",
          profileUrl: "https://steamcommunity.com/profiles/synthetic",
          avatarUrl: "https://cdn.example.invalid/avatar.jpg",
          visibility: "public",
          onlineState: "online",
          currentAppId: 620,
        },
        bans: {
          steamId,
          communityBanned: false,
          vacBanCount: 0,
          gameBanCount: 0,
          economyBan: "none",
        },
      },
      meta: {
        schema_version: "1",
        source_tiers: ["supported"],
        partial: false,
        warnings: [],
      },
    });
    expect(resolve).toHaveBeenCalledWith({ explicitUser: steamId }, signal);
    expect(getPlayers).toHaveBeenCalledWith([steamId], signal);
    expect(getPlayerBans).toHaveBeenCalledWith([steamId], signal);
  });

  it("returns NOT_FOUND for an unknown resolved SteamID64 without fetching bans", async () => {
    const steamId = parseSteamId64("76561198000000011");
    const getPlayerBans = vi.fn();
    const service = createSteamGetPlayerService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getPlayers: vi.fn().mockResolvedValue([]),
        getPlayerBans,
      },
    });

    await expect(
      service.execute({ explicitUser: steamId }, new AbortController().signal),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "The requested Steam player was not found",
        retryable: false,
      },
    });
    expect(getPlayerBans).not.toHaveBeenCalled();
  });

  it("returns an expected identity-resolution failure in the stable envelope", async () => {
    const service = createSteamGetPlayerService({
      identityResolver: {
        resolve: vi
          .fn()
          .mockRejectedValue(
            new SteamIdentityResolutionError(
              "IDENTITY_NOT_LINKED",
              "Provide a Steam user, or configure STEAM_USER",
            ),
          ),
      },
      steamData: { getPlayers: vi.fn(), getPlayerBans: vi.fn() },
    });

    await expect(
      service.execute({}, new AbortController().signal),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "IDENTITY_NOT_LINKED",
        message: "Provide a Steam user, or configure STEAM_USER",
        retryable: false,
      },
    });
  });

  it("preserves a private profile without inventing optional public fields", async () => {
    const steamId = parseSteamId64("76561198000000012");
    const profile = {
      steamId,
      displayName: "Private Player",
      profileUrl: "https://steamcommunity.com/profiles/private",
      visibility: "private" as const,
    };
    const bans = {
      steamId,
      communityBanned: false,
      vacBanCount: 0,
      gameBanCount: 0,
      economyBan: "none" as const,
    };
    const service = createSteamGetPlayerService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getPlayers: vi.fn().mockResolvedValue([profile]),
        getPlayerBans: vi.fn().mockResolvedValue([bans]),
      },
    });

    const result = await service.execute(
      { explicitUser: "private-subject" },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      ok: true,
      data: { steamId, profile, bans },
    });
    expect(result).not.toHaveProperty("data.profile.avatarUrl");
    expect(result).not.toHaveProperty("data.profile.currentAppId");
  });

  it("returns a stable upstream failure when the requested ban summary is absent", async () => {
    const steamId = parseSteamId64("76561198000000013");
    const service = createSteamGetPlayerService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getPlayers: vi.fn().mockResolvedValue([
          {
            steamId,
            displayName: "Synthetic Player",
            profileUrl: "https://steamcommunity.com/profiles/synthetic",
            visibility: "public",
          },
        ]),
        getPlayerBans: vi.fn().mockResolvedValue([]),
      },
    });

    await expect(
      service.execute({ explicitUser: steamId }, new AbortController().signal),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "Steam did not return the requested player's ban summary",
        retryable: false,
      },
    });
  });

  it("does not misclassify an unexpected identity dependency failure", async () => {
    const dependencyFailure = new Error("synthetic identity dependency outage");
    const service = createSteamGetPlayerService({
      identityResolver: {
        resolve: vi.fn().mockRejectedValue(dependencyFailure),
      },
      steamData: { getPlayers: vi.fn(), getPlayerBans: vi.fn() },
    });

    await expect(
      service.execute({}, new AbortController().signal),
    ).rejects.toBe(dependencyFailure);
  });
});
