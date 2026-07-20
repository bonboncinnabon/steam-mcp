import { z } from "zod";

import type { WishlistPageRequest } from "../../application/ports/steam-data.js";
import type { CurrencyCode } from "../../domain/currency.js";
import { parseAppId } from "../../domain/app-id.js";
import type { PlayerDataPage, WishlistItem } from "../../domain/steam-data.js";
import type { SteamId64 } from "../../domain/steam-id.js";
import { parseBestEffortResponse } from "../best-effort/best-effort-response.js";
import type { SteamHttpResponse } from "../http/steam-http-client.js";
import {
  buildSteamRequest,
  type SteamHttpRequest,
} from "../http/steam-request.js";
import { OptionalSourceDisabledError } from "../optional-source.js";

const uint32Schema = z.number().int().nonnegative().max(4_294_967_295);
const minorUnitsSchema = z
  .string()
  .regex(/^\d+$/)
  .refine((value) => Number.isSafeInteger(Number(value)));

const purchaseOptionSchema = z.object({
  price_in_cents: minorUnitsSchema,
  original_price_in_cents: minorUnitsSchema.optional(),
  discount_pct: z.number().int().min(0).max(100).optional(),
});

const wishlistItemSchema = z
  .object({
    appid: uint32Schema.positive(),
    priority: uint32Schema,
    date_added: uint32Schema,
    store_item: z
      .object({
        appid: uint32Schema.positive(),
        success: z.union([z.literal(0), z.literal(1)]),
        visible: z.boolean(),
        name: z.string().optional(),
        best_purchase_option: purchaseOptionSchema.optional(),
      })
      .optional(),
  })
  .refine(
    (item) =>
      item.store_item === undefined || item.store_item.appid === item.appid,
  );

const wishlistSchema = z.object({
  response: z.union([
    z.object({ items: z.array(wishlistItemSchema) }),
    z.object({}).strict(),
  ]),
});

export type SteamWishlistHttpExecutor = (
  request: SteamHttpRequest,
  signal: AbortSignal,
) => Promise<SteamHttpResponse>;

interface SteamWishlistAdapterOptions {
  readonly execute: SteamWishlistHttpExecutor;
  readonly enabled: boolean;
  readonly countryCode: string;
  readonly currency: CurrencyCode;
  readonly language: string;
  readonly maxPageSize: number;
}

export function createSteamWishlistAdapter(
  options: SteamWishlistAdapterOptions,
) {
  if (
    !/^[A-Z]{2}$/.test(options.countryCode) ||
    !/^[a-z]+$/.test(options.language) ||
    !Number.isInteger(options.maxPageSize) ||
    options.maxPageSize < 1 ||
    options.maxPageSize > 200
  ) {
    throw new RangeError("Invalid Steam wishlist storefront policy");
  }

  return {
    async getWishlist(
      steamId: SteamId64,
      page: WishlistPageRequest,
      signal: AbortSignal,
    ): Promise<PlayerDataPage<WishlistItem>> {
      if (!options.enabled) {
        throw new OptionalSourceDisabledError();
      }
      assertPageRequest(page, options.maxPageSize);
      const response = await options.execute(
        buildSteamRequest("getWishlist", {
          input_json: JSON.stringify({
            steamid: steamId,
            context: {
              language: options.language,
              country_code: options.countryCode,
              steam_realm: 1,
            },
            data_request: {
              include_basic_info: true,
              include_all_purchase_options: true,
            },
            filters: {},
            start_index: page.startIndex,
            page_size: page.pageSize,
            share_token: "",
          }),
        }),
        signal,
      );
      const parsed = parseBestEffortResponse(response.body, wishlistSchema);
      if (!("items" in parsed.response)) {
        return { visibility: "private", items: [] };
      }
      const pageItems = parsed.response.items.slice(
        page.startIndex,
        page.startIndex + page.pageSize,
      );
      return {
        visibility: "public",
        totalCount: parsed.response.items.length,
        items: pageItems.map((item) =>
          normalizeWishlistItem(item, options.currency),
        ),
      };
    },
  };
}

function assertPageRequest(
  page: WishlistPageRequest,
  maxPageSize: number,
): void {
  if (!Number.isInteger(page.startIndex) || page.startIndex < 0) {
    throw new RangeError("Wishlist start index must be a non-negative integer");
  }
  if (
    !Number.isInteger(page.pageSize) ||
    page.pageSize < 1 ||
    page.pageSize > maxPageSize
  ) {
    throw new RangeError("Wishlist page size exceeds its configured bounds");
  }
}

function normalizeWishlistItem(
  item: z.infer<typeof wishlistItemSchema>,
  currency: CurrencyCode,
): WishlistItem {
  const storeItem = item.store_item;
  const purchaseOption = storeItem?.best_purchase_option;
  return {
    appId: parseAppId(item.appid),
    ...(storeItem?.name === undefined ? {} : { name: storeItem.name }),
    available: storeItem?.success === 1 && storeItem.visible,
    ...(purchaseOption === undefined
      ? {}
      : {
          price: {
            minorUnits: Number(purchaseOption.price_in_cents),
            currency,
          },
        }),
    ...(purchaseOption?.discount_pct === undefined
      ? {}
      : { discountPercent: purchaseOption.discount_pct }),
  };
}
