import { z } from "zod";

import { parseAppId, type AppId } from "../../domain/app-id.js";
import { parseCurrencyCode } from "../../domain/currency.js";
import type {
  GameSearchCandidate,
  StoreGameDetails,
} from "../../domain/steam-data.js";
import {
  BestEffortSourceChangedError,
  parseBestEffortResponse,
} from "../best-effort/best-effort-response.js";
import type { SteamHttpResponse } from "../http/steam-http-client.js";
import {
  buildSteamRequest,
  type SteamHttpRequest,
} from "../http/steam-request.js";
import { OptionalSourceDisabledError } from "../optional-source.js";
import { assertSteamStorefrontPolicy } from "../storefront-policy.js";

const moneySchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  initial: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  final: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  discount_percent: z.number().int().min(0).max(100),
});

const metascoreSchema = z
  .string()
  .regex(/^\d{1,3}$/)
  .refine((value) => Number(value) <= 100);

const storeSearchSchema = z.object({
  total: z.number().int().nonnegative(),
  items: z
    .array(
      z.object({
        type: z.literal("app"),
        name: z.string().min(1),
        id: z.number().int().positive().max(4_294_967_295),
        tiny_image: z.url().optional(),
        price: moneySchema.optional(),
        platforms: z
          .object({
            windows: z.boolean(),
            mac: z.boolean(),
            linux: z.boolean(),
          })
          .optional(),
        metascore: z.union([z.literal(""), metascoreSchema]).optional(),
        controller_support: z.string().min(1).optional(),
      }),
    )
    .max(10),
});

const descriptorSchema = z.object({
  description: z.string().min(1),
});

function createStoreDetailsSchema(appId: number) {
  return z.record(
    z.string(),
    z.union([
      z.object({ success: z.literal(false) }),
      z.object({
        success: z.literal(true),
        data: z.object({
          steam_appid: z.literal(appId),
          name: z.string().min(1),
          short_description: z.string().optional(),
          developers: z.array(z.string()).optional(),
          publishers: z.array(z.string()).optional(),
          genres: z.array(descriptorSchema).optional(),
          categories: z.array(descriptorSchema).optional(),
          price_overview: moneySchema.optional(),
          release_date: z
            .object({
              coming_soon: z.boolean(),
              date: z.string(),
            })
            .optional(),
        }),
      }),
    ]),
  );
}

const STORE_DETAIL_FILTERS =
  "basic,developers,publishers,genres,categories,price_overview,release_date";

export type SteamStoreHttpExecutor = (
  request: SteamHttpRequest,
  signal: AbortSignal,
) => Promise<SteamHttpResponse>;

interface SteamStoreAdapterOptions {
  readonly execute: SteamStoreHttpExecutor;
  readonly searchEnabled: boolean;
  readonly detailsEnabled: boolean;
  readonly countryCode: string;
  readonly language: string;
}

export function createSteamStoreAdapter(options: SteamStoreAdapterOptions) {
  assertSteamStorefrontPolicy(options.countryCode, options.language);

  return {
    async searchGames(
      query: string,
      signal: AbortSignal,
    ): Promise<readonly GameSearchCandidate[]> {
      if (!options.searchEnabled) {
        throw new OptionalSourceDisabledError();
      }
      const normalizedQuery = query.trim();
      if (normalizedQuery.length === 0 || normalizedQuery.length > 100) {
        throw new RangeError(
          "Store search query must contain 1 to 100 characters",
        );
      }
      const response = await options.execute(
        buildSteamRequest("storeSearch", {
          term: normalizedQuery,
          l: options.language,
          cc: options.countryCode,
        }),
        signal,
      );
      const parsed = parseBestEffortResponse(response.body, storeSearchSchema);
      return parsed.items.map(normalizeSearchCandidate);
    },
    async getStoreGame(
      appId: AppId,
      signal: AbortSignal,
    ): Promise<StoreGameDetails | undefined> {
      if (!options.detailsEnabled) {
        throw new OptionalSourceDisabledError();
      }
      const response = await options.execute(
        buildSteamRequest("storeGameDetails", {
          appids: String(appId),
          cc: options.countryCode,
          l: options.language,
          filters: STORE_DETAIL_FILTERS,
        }),
        signal,
      );
      const parsed = parseBestEffortResponse(
        response.body,
        createStoreDetailsSchema(appId),
      );
      const keys = Object.keys(parsed);
      const entry = parsed[String(appId)];
      if (keys.length !== 1 || entry === undefined) {
        throw new BestEffortSourceChangedError();
      }
      if (!entry.success) {
        return undefined;
      }
      return normalizeStoreGame(entry.data);
    },
  };
}

function normalizeSearchCandidate(
  item: z.infer<typeof storeSearchSchema>["items"][number],
): GameSearchCandidate {
  return {
    appId: parseAppId(item.id),
    name: item.name,
    ...(item.tiny_image === undefined ? {} : { imageUrl: item.tiny_image }),
    ...(item.price === undefined
      ? {}
      : {
          price: {
            minorUnits: item.price.final,
            currency: parseCurrencyCode(item.price.currency),
          },
          originalPrice: {
            minorUnits: item.price.initial,
            currency: parseCurrencyCode(item.price.currency),
          },
          discountPercent: item.price.discount_percent,
        }),
    ...(item.platforms === undefined ? {} : { platforms: item.platforms }),
    ...(item.metascore === undefined || item.metascore === ""
      ? {}
      : { metascore: Number(item.metascore) }),
    ...(item.controller_support === undefined
      ? {}
      : { controllerSupport: item.controller_support }),
  };
}

function normalizeStoreGame(
  data: Extract<
    z.infer<ReturnType<typeof createStoreDetailsSchema>>[string],
    { success: true }
  >["data"],
): StoreGameDetails {
  const price = data.price_overview;
  return {
    appId: parseAppId(data.steam_appid),
    name: data.name,
    ...(data.short_description === undefined
      ? {}
      : { shortDescription: data.short_description }),
    developers: data.developers ?? [],
    publishers: data.publishers ?? [],
    genres: (data.genres ?? []).map((genre) => genre.description),
    categories: (data.categories ?? []).map((category) => category.description),
    ...(price === undefined
      ? {}
      : {
          price: {
            minorUnits: price.final,
            currency: parseCurrencyCode(price.currency),
          },
          originalPrice: {
            minorUnits: price.initial,
            currency: parseCurrencyCode(price.currency),
          },
          discountPercent: price.discount_percent,
        }),
    ...(data.release_date?.date === undefined
      ? {}
      : { releaseDate: data.release_date.date }),
  };
}
