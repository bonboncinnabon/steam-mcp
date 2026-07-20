import { describe, expect, it, vi } from "vitest";

import { createSteamGetWishlistService } from "../../../src/application/services/steam-get-wishlist.js";
import { SteamIdentityResolutionError } from "../../../src/application/services/steam-identity-resolver.js";
import { parseAppId } from "../../../src/domain/app-id.js";
import { parseCurrencyCode } from "../../../src/domain/currency.js";
import { parseSteamId64 } from "../../../src/domain/steam-id.js";
import { BestEffortSourceChangedError } from "../../../src/steam/best-effort/best-effort-response.js";

describe("steam_get_wishlist application service", () => {
  it("returns a best-effort page with normalized store fields", async () => {
    const steamId = parseSteamId64("76561198000000000");
    const signal = new AbortController().signal;
    const getWishlist = vi.fn().mockResolvedValue({
      visibility: "public",
      totalCount: 2,
      items: [
        {
          appId: parseAppId(620),
          name: "Portal 2",
          available: true,
          price: {
            minorUnits: 499,
            currency: parseCurrencyCode("USD"),
          },
          discountPercent: 50,
        },
        { appId: parseAppId(999_999_999), available: false },
      ],
    });
    const service = createSteamGetWishlistService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: { getWishlist },
      maxPageSize: 100,
    });

    await expect(
      service.execute({ explicitUser: steamId, limit: 20 }, signal),
    ).resolves.toEqual({
      ok: true,
      data: {
        steamId,
        items: [
          {
            appId: 620,
            name: "Portal 2",
            available: true,
            price: { minorUnits: 499, currency: "USD" },
            discountPercent: 50,
          },
          { appId: 999_999_999, available: false },
        ],
        totalCount: 2,
      },
      meta: {
        schema_version: "1",
        source_tiers: ["best_effort"],
        partial: false,
        warnings: [],
      },
    });
    expect(getWishlist).toHaveBeenCalledWith(
      steamId,
      { startIndex: 0, pageSize: 20 },
      signal,
    );
  });

  it("returns PROFILE_PRIVATE rather than a known-empty wishlist", async () => {
    const steamId = parseSteamId64("76561198000000001");
    const service = createSteamGetWishlistService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "linked" }),
      },
      steamData: {
        getWishlist: vi.fn().mockResolvedValue({
          visibility: "private",
          items: [],
        }),
      },
      maxPageSize: 100,
    });

    await expect(
      service.execute(
        { subject: "private-user", limit: 20 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "PROFILE_PRIVATE", retryable: false },
    });
  });

  it("returns an opaque continuation when more wishlist items exist", async () => {
    const steamId = parseSteamId64("76561198000000002");
    const service = createSteamGetWishlistService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getWishlist: vi.fn().mockResolvedValue({
          visibility: "public",
          totalCount: 3,
          items: [
            { appId: parseAppId(10), available: true },
            { appId: parseAppId(20), available: false },
          ],
        }),
      },
      maxPageSize: 100,
    });

    const result = await service.execute(
      { explicitUser: steamId, limit: 2 },
      new AbortController().signal,
    );

    expect(result).toHaveProperty("data.nextCursor");
    expect(result).not.toHaveProperty("data.offset");
  });

  it("continues at the opaque offset without repeating wishlist items", async () => {
    const steamId = parseSteamId64("76561198000000003");
    const getWishlist = vi
      .fn()
      .mockResolvedValueOnce({
        visibility: "public",
        totalCount: 3,
        items: [
          { appId: parseAppId(10), available: true },
          { appId: parseAppId(20), available: true },
        ],
      })
      .mockResolvedValueOnce({
        visibility: "public",
        totalCount: 3,
        items: [{ appId: parseAppId(30), available: false }],
      });
    const service = createSteamGetWishlistService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: { getWishlist },
      maxPageSize: 100,
    });
    const signal = new AbortController().signal;
    const first = await service.execute(
      { explicitUser: steamId, limit: 2 },
      signal,
    );
    if (!first.ok || first.data.nextCursor === undefined) {
      throw new Error("Expected a wishlist continuation");
    }

    const second = await service.execute(
      {
        explicitUser: steamId,
        limit: 2,
        cursor: first.data.nextCursor,
      },
      signal,
    );

    expect(second).toMatchObject({
      ok: true,
      data: {
        totalCount: 3,
        items: [{ appId: 30, available: false }],
      },
    });
    expect(second).not.toHaveProperty("data.nextCursor");
    expect(getWishlist).toHaveBeenNthCalledWith(
      2,
      steamId,
      { startIndex: 2, pageSize: 2 },
      signal,
    );
  });

  it("rejects an invalid limit before identity or Steam work", async () => {
    const resolve = vi.fn();
    const getWishlist = vi.fn();
    const service = createSteamGetWishlistService({
      identityResolver: { resolve },
      steamData: { getWishlist },
      maxPageSize: 20,
    });

    await expect(
      service.execute({ limit: 21 }, new AbortController().signal),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(getWishlist).not.toHaveBeenCalled();
  });

  it("rejects an invalid maximum page size at construction", () => {
    expect(() =>
      createSteamGetWishlistService({
        identityResolver: { resolve: vi.fn() },
        steamData: { getWishlist: vi.fn() },
        maxPageSize: 0,
      }),
    ).toThrow("Wishlist maximum page size must be positive");
  });

  it("returns an expected identity failure in the stable envelope", async () => {
    const getWishlist = vi.fn();
    const service = createSteamGetWishlistService({
      identityResolver: {
        resolve: vi
          .fn()
          .mockRejectedValue(
            new SteamIdentityResolutionError(
              "IDENTITY_NOT_LINKED",
              "Provide a Steam user or link a default Steam identity",
            ),
          ),
      },
      steamData: { getWishlist },
      maxPageSize: 20,
    });

    await expect(
      service.execute({ limit: 20 }, new AbortController().signal),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "IDENTITY_NOT_LINKED", retryable: false },
    });
    expect(getWishlist).not.toHaveBeenCalled();
  });

  it("fails safely when wishlist pagination makes no progress", async () => {
    const steamId = parseSteamId64("76561198000000004");
    const service = createSteamGetWishlistService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getWishlist: vi.fn().mockResolvedValue({
          visibility: "public",
          totalCount: 3,
          items: [],
        }),
      },
      maxPageSize: 20,
    });

    await expect(
      service.execute(
        { explicitUser: steamId, limit: 20 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "BEST_EFFORT_SOURCE_CHANGED", retryable: false },
    });
  });

  it("preserves a known-public empty wishlist", async () => {
    const steamId = parseSteamId64("76561198000000005");
    const service = createSteamGetWishlistService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: {
        getWishlist: vi.fn().mockResolvedValue({
          visibility: "public",
          totalCount: 0,
          items: [],
        }),
      },
      maxPageSize: 20,
    });

    await expect(
      service.execute(
        { explicitUser: steamId, limit: 20 },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { totalCount: 0, items: [] },
      meta: { source_tiers: ["best_effort"], partial: false, warnings: [] },
    });
  });

  it("rejects a malformed cursor before identity or Steam work", async () => {
    const resolve = vi.fn();
    const getWishlist = vi.fn();
    const service = createSteamGetWishlistService({
      identityResolver: { resolve },
      steamData: { getWishlist },
      maxPageSize: 20,
    });

    await expect(
      service.execute({ limit: 20, cursor: "a" }, new AbortController().signal),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(getWishlist).not.toHaveBeenCalled();
  });

  it("binds continuation cursors to the resolved Steam user", async () => {
    const firstSteamId = parseSteamId64("76561198000000006");
    const secondSteamId = parseSteamId64("76561198000000007");
    const getWishlist = vi.fn().mockResolvedValue({
      visibility: "public",
      totalCount: 2,
      items: [{ appId: parseAppId(10), available: true }],
    });
    const service = createSteamGetWishlistService({
      identityResolver: {
        resolve: vi
          .fn()
          .mockResolvedValueOnce({ steamId: firstSteamId, source: "explicit" })
          .mockResolvedValueOnce({
            steamId: secondSteamId,
            source: "explicit",
          }),
      },
      steamData: { getWishlist },
      maxPageSize: 20,
    });
    const signal = new AbortController().signal;
    const first = await service.execute(
      { explicitUser: firstSteamId, limit: 1 },
      signal,
    );
    if (!first.ok || first.data.nextCursor === undefined) {
      throw new Error("Expected a user-bound wishlist cursor");
    }

    await expect(
      service.execute(
        {
          explicitUser: secondSteamId,
          limit: 1,
          cursor: first.data.nextCursor,
        },
        signal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
    expect(getWishlist).toHaveBeenCalledOnce();
  });

  it("rejects a continuation offset beyond a changed wishlist", async () => {
    const steamId = parseSteamId64("76561198000000008");
    const getWishlist = vi
      .fn()
      .mockResolvedValueOnce({
        visibility: "public",
        totalCount: 3,
        items: [
          { appId: parseAppId(10), available: true },
          { appId: parseAppId(20), available: true },
        ],
      })
      .mockResolvedValueOnce({
        visibility: "public",
        totalCount: 1,
        items: [],
      });
    const service = createSteamGetWishlistService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: { getWishlist },
      maxPageSize: 20,
    });
    const signal = new AbortController().signal;
    const first = await service.execute(
      { explicitUser: steamId, limit: 2 },
      signal,
    );
    if (!first.ok || first.data.nextCursor === undefined) {
      throw new Error("Expected a wishlist continuation offset");
    }

    await expect(
      service.execute(
        {
          explicitUser: steamId,
          limit: 2,
          cursor: first.data.nextCursor,
        },
        signal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", retryable: false },
    });
  });

  it("does not misclassify an unexpected identity dependency failure", async () => {
    const dependencyFailure = new Error("synthetic identity dependency outage");
    const service = createSteamGetWishlistService({
      identityResolver: {
        resolve: vi.fn().mockRejectedValue(dependencyFailure),
      },
      steamData: { getWishlist: vi.fn() },
      maxPageSize: 20,
    });

    await expect(
      service.execute({ limit: 20 }, new AbortController().signal),
    ).rejects.toBe(dependencyFailure);
  });

  it("propagates sanitized best-effort source drift", async () => {
    const steamId = parseSteamId64("76561198000000009");
    const drift = new BestEffortSourceChangedError();
    const service = createSteamGetWishlistService({
      identityResolver: {
        resolve: vi.fn().mockResolvedValue({ steamId, source: "explicit" }),
      },
      steamData: { getWishlist: vi.fn().mockRejectedValue(drift) },
      maxPageSize: 20,
    });

    await expect(
      service.execute(
        { explicitUser: steamId, limit: 20 },
        new AbortController().signal,
      ),
    ).rejects.toBe(drift);
  });
});
