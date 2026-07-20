import { z } from "zod";

import { parseIsoTimestamp } from "../../domain/iso-timestamp.js";
import type {
  EnrichedFriendRelationship,
  FriendRelationship,
  PlayerDataCollection,
  PlayerSummary,
} from "../../domain/steam-data.js";
import { parseSteamId64, type SteamId64 } from "../../domain/steam-id.js";
import type { SteamHttpResponse } from "../http/steam-http-client.js";
import {
  buildSteamRequest,
  type SteamHttpRequest,
} from "../http/steam-request.js";
import { parseSteamResponse } from "../http/steam-response.js";

const friendListSchema = z.object({
  friendslist: z.object({
    friends: z.array(
      z.object({
        steamid: z.string().regex(/^\d{17}$/),
        relationship: z.literal("friend"),
        friend_since: z.number().int().nonnegative().max(4_294_967_295),
      }),
    ),
  }),
});

export type SteamFriendHttpExecutor = (
  request: SteamHttpRequest,
  signal: AbortSignal,
) => Promise<SteamHttpResponse>;

interface SteamFriendAdapterOptions {
  readonly apiKey: string;
  readonly execute: SteamFriendHttpExecutor;
}

export type SteamPlayerBatchFetcher = (
  steamIds: readonly SteamId64[],
  signal: AbortSignal,
) => Promise<readonly PlayerSummary[]>;

export function createSteamFriendAdapter(options: SteamFriendAdapterOptions) {
  return {
    async getFriends(
      steamId: SteamId64,
      signal: AbortSignal,
    ): Promise<PlayerDataCollection<FriendRelationship>> {
      const response = await options.execute(
        buildSteamRequest("getFriendList", {
          key: options.apiKey,
          steamid: steamId,
          relationship: "friend",
        }),
        signal,
      );
      if (response.status === 401) {
        return { visibility: "private", items: [] };
      }
      const parsed = parseSteamResponse(response.body, friendListSchema);
      return {
        visibility: "public",
        items: parsed.friendslist.friends.map((friend) => ({
          steamId: parseSteamId64(friend.steamid),
          ...(friend.friend_since === 0
            ? {}
            : {
                friendsSince: parseIsoTimestamp(
                  new Date(friend.friend_since * 1_000).toISOString(),
                ),
              }),
        })),
      };
    },
  };
}

export async function enrichFriendProfiles(
  friends: readonly FriendRelationship[],
  maxProfiles: number,
  fetchPlayers: SteamPlayerBatchFetcher,
  signal: AbortSignal,
): Promise<readonly EnrichedFriendRelationship[]> {
  if (!Number.isInteger(maxProfiles) || maxProfiles < 1 || maxProfiles > 100) {
    throw new RangeError("Friend enrichment limit must be between 1 and 100");
  }
  assertNotCancelled(signal);
  if (friends.length === 0) {
    return [];
  }

  const selected = friends.slice(0, maxProfiles);
  const profiles = await fetchPlayers(
    selected.map((friend) => friend.steamId),
    signal,
  );
  assertNotCancelled(signal);
  const profileById = new Map(
    profiles.map((profile) => [profile.steamId, profile]),
  );

  return friends.map((relationship, index) => {
    if (index >= selected.length) {
      return {
        relationship,
        enrichment: { status: "fan_out_limited" },
      };
    }
    const profile = profileById.get(relationship.steamId);
    return {
      relationship,
      enrichment:
        profile === undefined
          ? { status: "unavailable" }
          : { status: "available", profile },
    };
  });
}

function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error("Steam friend enrichment cancelled");
  }
}
