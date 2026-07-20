import { z } from "zod";

import type { AppId } from "../../domain/app-id.js";
import type { GameTag } from "../../domain/steam-data.js";
import { parseBestEffortResponse } from "../best-effort/best-effort-response.js";
import type { SteamHttpResponse } from "../http/steam-http-client.js";
import {
  buildSteamRequest,
  buildSteamTagVocabularyRequest,
  type SteamHttpRequest,
} from "../http/steam-request.js";
import { OptionalSourceDisabledError } from "../optional-source.js";
import { assertSteamStorefrontPolicy } from "../storefront-policy.js";

const uint32Schema = z.number().int().positive().max(4_294_967_295);
const weightSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const weightedTagSchema = z.object({
  tagid: uint32Schema,
  weight: weightSchema,
});

function hasUniqueTagIds(tags: readonly { readonly tagid: number }[]): boolean {
  return new Set(tags.map((tag) => tag.tagid)).size === tags.length;
}

function createStoreTagsSchema(appId: AppId) {
  const matchingApp = { appid: z.literal(appId) };
  return z.object({
    response: z.object({
      store_items: z.tuple([
        z.union([
          z.object({
            ...matchingApp,
            success: z.literal(1),
            tags: z
              .array(weightedTagSchema)
              .max(20)
              .refine(hasUniqueTagIds)
              .optional(),
          }),
          z.object({
            ...matchingApp,
            success: z
              .number()
              .int()
              .nonnegative()
              .max(Number.MAX_SAFE_INTEGER)
              .refine((success) => success !== 1),
          }),
        ]),
      ]),
    }),
  });
}

const tagVocabularySchema = z
  .array(
    z.object({
      tagid: uint32Schema,
      name: z.string().trim().min(1),
    }),
  )
  .refine(hasUniqueTagIds);

export type SteamTagHttpExecutor = (
  request: SteamHttpRequest,
  signal: AbortSignal,
) => Promise<SteamHttpResponse>;

interface SteamTagAdapterOptions {
  readonly execute: SteamTagHttpExecutor;
  readonly enabled: boolean;
  readonly countryCode: string;
  readonly language: string;
}

interface WeightedTag {
  readonly tagId: number;
  readonly weight: number;
}

interface TagName {
  readonly tagId: number;
  readonly name: string;
}

export function createSteamTagAdapter(options: SteamTagAdapterOptions) {
  assertSteamStorefrontPolicy(options.countryCode, options.language);

  async function getAppTags(
    appId: AppId,
    signal: AbortSignal,
  ): Promise<readonly WeightedTag[] | undefined> {
    assertEnabled(options.enabled);
    const response = await options.execute(
      buildSteamRequest("getStoreTags", {
        input_json: JSON.stringify({
          ids: [{ appid: appId }],
          context: {
            language: options.language,
            country_code: options.countryCode,
          },
          data_request: { include_tag_count: 20 },
        }),
      }),
      signal,
    );
    const parsed = parseBestEffortResponse(
      response.body,
      createStoreTagsSchema(appId),
    );
    const item = parsed.response.store_items[0];
    if (item.success !== 1) {
      return undefined;
    }
    const tags = "tags" in item ? item.tags : undefined;
    return (tags ?? []).map((tag) => ({
      tagId: tag.tagid,
      weight: tag.weight,
    }));
  }

  async function getTagVocabulary(
    signal: AbortSignal,
  ): Promise<readonly TagName[]> {
    assertEnabled(options.enabled);
    const response = await options.execute(
      buildSteamTagVocabularyRequest(options.language),
      signal,
    );
    const parsed = parseBestEffortResponse(response.body, tagVocabularySchema);
    return parsed.map((tag) => ({ tagId: tag.tagid, name: tag.name }));
  }

  return {
    getAppTags,
    getTagVocabulary,
    async getGameTags(
      appId: AppId,
      signal: AbortSignal,
    ): Promise<readonly GameTag[] | undefined> {
      const tags = await getAppTags(appId, signal);
      if (tags === undefined || tags.length === 0) {
        return tags;
      }
      const vocabulary = await getTagVocabulary(signal);
      const nameById = new Map(
        vocabulary.map((tag) => [tag.tagId, tag.name] as const),
      );
      return tags.map((tag) => {
        const name = nameById.get(tag.tagId);
        return { ...tag, ...(name === undefined ? {} : { name }) };
      });
    },
  };
}

function assertEnabled(enabled: boolean): void {
  if (!enabled) {
    throw new OptionalSourceDisabledError();
  }
}
