import { z } from "zod";

import { STEAM_GAME_FACETS } from "../application/services/steam-get-game.js";
import { ERROR_CODES, SOURCE_TIERS } from "../domain/result.js";
import { BASELINE_SERVICE_POLICY } from "../domain/service-policy.js";
import { parseSteamUserReference } from "../identity/steam-user-reference.js";

const READ_ONLY_STEAM_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const publicUserSchema = z
  .string()
  .refine(
    (value) => isSteamUserReference(value),
    "Invalid Steam user reference",
  )
  .describe(
    "SteamID64, vanity name, or HTTPS steamcommunity.com profile URL; omit to use the operator-configured STEAM_USER default.",
  );

const cursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/)
  .describe("Opaque cursor returned by the previous page.");
const appIdSchema = z.number().int().min(1).max(4_294_967_295);

const steamIdSchema = z.string().regex(/^\d{17}$/);
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const isoTimestampSchema = z.iso.datetime({ offset: false });
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const priceSchema = z.strictObject({
  minorUnits: nonNegativeIntegerSchema,
  currency: currencySchema.optional(),
});
const ownedGameSchema = z.strictObject({
  appId: appIdSchema,
  name: z.string().optional(),
  playtimeMinutes: nonNegativeIntegerSchema,
  recentPlaytimeMinutes: nonNegativeIntegerSchema.optional(),
  lastPlayedAt: isoTimestampSchema.optional(),
});
const playerSummarySchema = z.strictObject({
  steamId: steamIdSchema,
  displayName: z.string().min(1),
  profileUrl: z.url(),
  avatarUrl: z.url().optional(),
  visibility: z.enum(["public", "private"]),
  onlineState: z.enum(["offline", "online", "busy", "away"]).optional(),
  currentAppId: appIdSchema.optional(),
  lastLogoffAt: isoTimestampSchema.optional(),
});
const successMetaSchema = z.strictObject({
  schema_version: z.literal("1"),
  source_tiers: z.array(z.enum(SOURCE_TIERS)),
  partial: z.boolean(),
  warnings: z.array(z.string()),
});

const toolErrorSchema = z.strictObject({
  code: z.enum(ERROR_CODES),
  message: z.string().min(1),
  retryable: z.boolean(),
});

export const TOOL_FAILURE_OUTPUT_SCHEMA = z.strictObject({
  ok: z.literal(false),
  error: toolErrorSchema,
});

function toolOutputSchema<DataSchema extends z.ZodType>(data: DataSchema) {
  return z
    .strictObject({
      ok: z.boolean(),
      data: data.optional(),
      meta: successMetaSchema.optional(),
      error: toolErrorSchema.optional(),
    })
    .superRefine((result, context) => {
      const isSuccessShape =
        result.ok &&
        result.data !== undefined &&
        result.meta !== undefined &&
        result.error === undefined;
      const isFailureShape =
        !result.ok &&
        result.data === undefined &&
        result.meta === undefined &&
        result.error !== undefined;
      if (!isSuccessShape && !isFailureShape) {
        context.addIssue({
          code: "custom",
          message: "Invalid Steam tool result envelope",
        });
      }
    });
}

const playerOutputSchema = toolOutputSchema(
  z.strictObject({
    steamId: steamIdSchema,
    profile: playerSummarySchema,
    bans: z.strictObject({
      steamId: steamIdSchema,
      communityBanned: z.boolean(),
      vacBanCount: nonNegativeIntegerSchema,
      gameBanCount: nonNegativeIntegerSchema,
      economyBan: z.enum(["none", "probation", "banned"]),
    }),
  }),
);
const libraryOutputSchema = toolOutputSchema(
  z.strictObject({
    steamId: steamIdSchema,
    games: z.array(ownedGameSchema),
    totalCount: nonNegativeIntegerSchema,
    nextCursor: cursorSchema.optional(),
  }),
);
const currentActivitySchema = z.union([
  z.strictObject({
    status: z.literal("playing"),
    appId: appIdSchema,
    onlineState: z.enum(["offline", "online", "busy", "away"]).optional(),
  }),
  z.strictObject({
    status: z.literal("not_playing"),
    onlineState: z.enum(["offline", "online", "busy", "away"]).optional(),
  }),
  z.strictObject({ status: z.literal("unavailable") }),
]);
const recentActivityOutputSchema = toolOutputSchema(
  z.strictObject({
    steamId: steamIdSchema,
    recentGames: z.array(ownedGameSchema),
    currentActivity: currentActivitySchema,
  }),
);
const achievementOutputSchema = toolOutputSchema(
  z.strictObject({
    steamId: steamIdSchema,
    appId: appIdSchema,
    achievements: z.array(
      z.strictObject({
        apiName: z.string().min(1),
        displayName: z.string().optional(),
        description: z.string().optional(),
        achieved: z.boolean(),
        unlockedAt: isoTimestampSchema.optional(),
        globalPercent: z.number().min(0).max(100).optional(),
      }),
    ),
    totalCount: nonNegativeIntegerSchema,
    nextCursor: cursorSchema.optional(),
  }),
);
const friendRelationshipSchema = z.strictObject({
  steamId: steamIdSchema,
  friendsSince: isoTimestampSchema.optional(),
});
const enrichedFriendRelationshipSchema = z.strictObject({
  relationship: friendRelationshipSchema,
  enrichment: z.union([
    z.strictObject({
      status: z.literal("available"),
      profile: playerSummarySchema,
    }),
    z.strictObject({ status: z.literal("unavailable") }),
    z.strictObject({ status: z.literal("fan_out_limited") }),
  ]),
});
const friendsOutputSchema = toolOutputSchema(
  z.strictObject({
    steamId: steamIdSchema,
    friends: z.array(
      z.union([friendRelationshipSchema, enrichedFriendRelationshipSchema]),
    ),
    totalCount: nonNegativeIntegerSchema,
    nextCursor: cursorSchema.optional(),
  }),
);
const wishlistOutputSchema = toolOutputSchema(
  z.strictObject({
    steamId: steamIdSchema,
    items: z.array(
      z.strictObject({
        appId: appIdSchema,
        name: z.string().optional(),
        available: z.boolean(),
        price: priceSchema.optional(),
        discountPercent: z.number().int().min(0).max(100).optional(),
      }),
    ),
    totalCount: nonNegativeIntegerSchema,
    nextCursor: cursorSchema.optional(),
  }),
);
const searchOutputSchema = toolOutputSchema(
  z.strictObject({
    query: z.string().min(1).max(100),
    candidates: z.array(
      z.strictObject({
        appId: appIdSchema,
        name: z.string().min(1),
        releaseDate: z.string().optional(),
        imageUrl: z.url().optional(),
        price: priceSchema.optional(),
        originalPrice: priceSchema.optional(),
        discountPercent: z.number().int().min(0).max(100).optional(),
        platforms: z
          .strictObject({
            windows: z.boolean(),
            mac: z.boolean(),
            linux: z.boolean(),
          })
          .optional(),
        metascore: z.number().int().min(0).max(100).optional(),
        controllerSupport: z.string().optional(),
      }),
    ),
  }),
);
const storeGameSchema = z.strictObject({
  appId: appIdSchema,
  name: z.string().min(1),
  shortDescription: z.string().optional(),
  developers: z.array(z.string()),
  publishers: z.array(z.string()),
  genres: z.array(z.string()),
  categories: z.array(z.string()),
  price: priceSchema.optional(),
  originalPrice: priceSchema.optional(),
  discountPercent: z.number().int().min(0).max(100).optional(),
  releaseDate: z.string().optional(),
});
const gameOutputSchema = toolOutputSchema(
  z.strictObject({
    appId: appIdSchema,
    facets: z.strictObject({
      storeDetails: storeGameSchema,
      reviews: z
        .strictObject({
          totalPositive: nonNegativeIntegerSchema,
          totalNegative: nonNegativeIntegerSchema,
          scoreDescription: z.string().optional(),
        })
        .optional(),
      currentPlayers: nonNegativeIntegerSchema.optional(),
      deckCompatibility: z
        .strictObject({
          category: z.enum(["unknown", "unsupported", "playable", "verified"]),
          summary: z.string().optional(),
        })
        .optional(),
      news: z
        .array(
          z.strictObject({
            id: z.string().min(1),
            title: z.string().min(1),
            url: z.url(),
            publishedAt: isoTimestampSchema,
          }),
        )
        .optional(),
      globalAchievements: z
        .strictObject({
          definitions: z.array(
            z.strictObject({
              apiName: z.string().min(1),
              displayName: z.string().optional(),
              description: z.string().optional(),
              hidden: z.boolean(),
              iconUrl: z.url().optional(),
              lockedIconUrl: z.url().optional(),
            }),
          ),
          percentages: z.array(
            z.strictObject({
              apiName: z.string().min(1),
              globalPercent: z.number().min(0).max(100),
            }),
          ),
        })
        .optional(),
    }),
    unavailableFacets: z.array(
      z.strictObject({
        facet: z.enum(STEAM_GAME_FACETS),
        sourceTier: z.enum(SOURCE_TIERS),
        code: z.enum(ERROR_CODES),
      }),
    ),
  }),
);

interface SteamToolContractPolicy {
  readonly defaultPageSize: number;
  readonly maxPageSize: number;
  readonly maxSearchResults: number;
}

export function createSteamToolContracts(policy: SteamToolContractPolicy) {
  const input = createInputSchemas(policy);
  return {
    steam_get_player: defineContract(
      "Get Steam player",
      "Get one public Steam profile with visibility, presence, current game, and ban-summary facts.",
      input.player,
      playerOutputSchema,
    ),
    steam_get_library: defineContract(
      "Get Steam library",
      "Get a filtered, sorted, cursor-paginated public Steam game library with recorded playtime facts.",
      input.library,
      libraryOutputSchema,
    ),
    steam_get_recent_activity: defineContract(
      "Get recent Steam activity",
      "Get a bounded list of recently played Steam games and the player's available current activity.",
      input.recentActivity,
      recentActivityOutputSchema,
    ),
    steam_get_achievements: defineContract(
      "Get Steam achievements",
      "Get cursor-paginated achievement progress for one public Steam player and one exact Steam app ID.",
      input.achievements,
      achievementOutputSchema,
    ),
    steam_get_friends: defineContract(
      "Get Steam friends",
      "Get a cursor-paginated public Steam friend list with optional bounded profile and presence enrichment.",
      input.friends,
      friendsOutputSchema,
    ),
    steam_get_wishlist: defineContract(
      "Get Steam wishlist",
      "Get a cursor-paginated public Steam wishlist with current availability, price, and discount facts.",
      input.wishlist,
      wishlistOutputSchema,
    ),
    steam_search_games: defineContract(
      "Search Steam games",
      "Search Steam for bounded game candidates and return stable app IDs and disambiguating store facts.",
      input.searchGames,
      searchOutputSchema,
    ),
    steam_get_game: defineContract(
      "Get Steam game",
      "Get required store details for one exact Steam app ID plus only the explicitly selected optional facets.",
      input.game,
      gameOutputSchema,
    ),
  } as const;
}

export const STEAM_TOOL_CONTRACTS = createSteamToolContracts({
  defaultPageSize: BASELINE_SERVICE_POLICY.defaultPageSize,
  maxPageSize: BASELINE_SERVICE_POLICY.maxPageSize,
  maxSearchResults: 10,
});

function createInputSchemas(policy: SteamToolContractPolicy) {
  if (
    !Number.isInteger(policy.defaultPageSize) ||
    policy.defaultPageSize < 1 ||
    !Number.isInteger(policy.maxPageSize) ||
    policy.maxPageSize < policy.defaultPageSize ||
    policy.maxPageSize > 200 ||
    !Number.isInteger(policy.maxSearchResults) ||
    policy.maxSearchResults < 1 ||
    policy.maxSearchResults > 10
  ) {
    throw new RangeError("Invalid Steam tool contract bounds");
  }
  const pageLimit = z
    .number()
    .int()
    .min(1)
    .max(policy.maxPageSize)
    .default(policy.defaultPageSize);
  return {
    player: z.strictObject({ user: publicUserSchema.optional() }),
    library: z.strictObject({
      user: publicUserSchema.optional(),
      limit: pageLimit,
      cursor: cursorSchema.optional(),
      query: z.string().trim().max(100).optional(),
      played: z.enum(["all", "played", "unplayed"]).default("all"),
      sortBy: z.enum(["name", "playtime", "recent"]).default("name"),
      sortDirection: z.enum(["asc", "desc"]).default("asc"),
    }),
    recentActivity: z.strictObject({
      user: publicUserSchema.optional(),
      limit: pageLimit,
    }),
    achievements: z.strictObject({
      user: publicUserSchema.optional(),
      appId: appIdSchema,
      limit: pageLimit,
      cursor: cursorSchema.optional(),
      state: z.enum(["all", "locked", "unlocked"]).default("all"),
    }),
    friends: z.strictObject({
      user: publicUserSchema.optional(),
      limit: pageLimit,
      cursor: cursorSchema.optional(),
      includePresence: z.boolean().default(false),
    }),
    wishlist: z.strictObject({
      user: publicUserSchema.optional(),
      limit: pageLimit,
      cursor: cursorSchema.optional(),
    }),
    searchGames: z.strictObject({
      query: z.string().trim().min(1).max(100),
      limit: z
        .number()
        .int()
        .min(1)
        .max(policy.maxSearchResults)
        .default(policy.maxSearchResults),
    }),
    game: z.strictObject({
      appId: appIdSchema,
      facets: z
        .array(z.enum(STEAM_GAME_FACETS))
        .max(STEAM_GAME_FACETS.length)
        .refine((facets) => new Set(facets).size === facets.length)
        .default([]),
    }),
  };
}

function defineContract<
  InputSchema extends z.ZodType,
  OutputSchema extends z.ZodType,
>(
  title: string,
  description: string,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
) {
  return {
    title,
    description,
    annotations: READ_ONLY_STEAM_ANNOTATIONS,
    inputSchema,
    outputSchema,
  };
}

function isSteamUserReference(value: string): boolean {
  try {
    parseSteamUserReference(value);
    return true;
  } catch {
    return false;
  }
}
