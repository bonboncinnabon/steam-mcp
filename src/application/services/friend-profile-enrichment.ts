import type {
  EnrichedFriendRelationship,
  FriendRelationship,
  PlayerSummary,
} from "../../domain/steam-data.js";
import type { SteamId64 } from "../../domain/steam-id.js";

export type SteamPlayerBatchFetcher = (
  steamIds: readonly SteamId64[],
  signal: AbortSignal,
) => Promise<readonly PlayerSummary[]>;

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
