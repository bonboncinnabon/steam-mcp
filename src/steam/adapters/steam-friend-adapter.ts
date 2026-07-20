import { z } from "zod";

import { parseIsoTimestamp } from "../../domain/iso-timestamp.js";
import type {
  FriendRelationship,
  PlayerDataCollection,
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
