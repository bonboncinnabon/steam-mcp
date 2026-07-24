# Tool reference

Steam MCP exposes exactly eight read-only tools. Unknown input fields are
rejected. All collection sizes are bounded by the deployed service policy; the
baseline defaults are a page size of 20 and a maximum of 100. Game search is
always limited to 10 candidates.

The tools return concise text for people and models plus `structuredContent` as
the compatibility contract. Types below use `?` for optional fields.

## Common contracts

### User references

Subject-oriented tools accept an optional `user` string in one of these forms:

- a 17-digit SteamID64;
- a 2-to-32-character vanity name containing letters, digits, `_`, or `-`;
- an HTTPS `steamcommunity.com/profiles/{SteamID64}` URL; or
- an HTTPS `steamcommunity.com/id/{vanity}` URL.

The URL form cannot contain credentials, a query, or a fragment. In either mode,
omitting `user` uses the operator-configured `STEAM_USER` when present. An
explicit `user` always takes precedence. In self-hosted HTTP mode this default
is shared by every authorized client; it is not a per-client account link. The
bearer token grants access to the instance and is never mapped to a Steam user.
Failure to provide either produces `IDENTITY_NOT_LINKED`.

### Result envelope

Every success has this shape:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "schema_version": "1",
    "source_tiers": ["supported"],
    "partial": false,
    "warnings": []
  }
}
```

`source_tiers` contains `supported`, `best_effort`, or `derived` as applicable.
`partial: true` means the documented `data` is usable but an optional enrichment
or facet was unavailable; `warnings` explains the omission.

Every expected failure sets MCP `isError: true` and has this shape:

```json
{
  "ok": false,
  "error": {
    "code": "PROFILE_PRIVATE",
    "message": "The requested Steam profile data is private.",
    "retryable": false
  }
}
```

Stable error codes are:

| Code                         | Meaning                                                                  |
| ---------------------------- | ------------------------------------------------------------------------ |
| `INVALID_INPUT`              | Input, bound, or cursor is invalid for this request.                     |
| `IDENTITY_NOT_LINKED`        | No explicit user or operator-configured default was supplied.            |
| `PROFILE_PRIVATE`            | Steam does not expose the requested player data publicly.                |
| `NOT_FOUND`                  | The requested Steam user, app, or data was not found.                    |
| `STEAM_AUTH_FAILED`          | The Steam API credential is missing or rejected.                         |
| `STEAM_RATE_LIMITED`         | Steam rate-limited the request.                                          |
| `UPSTREAM_UNAVAILABLE`       | Steam or an optional dependency is unavailable.                          |
| `BEST_EFFORT_SOURCE_CHANGED` | An undocumented Steam response no longer matches its validated contract. |
| `SERVICE_QUOTA_EXCEEDED`     | The self-hosted instance has exhausted its available quota.              |
| `INTERNAL_ERROR`             | An unexpected failure was converted to a safe public error.              |

Retry behavior is carried by `error.retryable`; clients should not infer it from
the code alone.

### Common value shapes

```text
Price = { minorUnits: integer >= 0, currency?: "USD" }

OwnedGame = {
  appId: integer 1..4294967295,
  name?: string,
  playtimeMinutes: integer >= 0,
  recentPlaytimeMinutes?: integer >= 0,
  lastPlayedAt?: ISO-8601 UTC timestamp
}

PlayerSummary = {
  steamId: 17-digit SteamID64,
  displayName: non-empty string,
  profileUrl: URL,
  avatarUrl?: URL,
  visibility: "public" | "private",
  onlineState?: "offline" | "online" | "busy" | "away",
  currentAppId?: integer 1..4294967295,
  lastLogoffAt?: ISO-8601 UTC timestamp
}
```

Currency is optional when Steam does not provide an authoritative currency.
Prices are integer minor units; formatted price text is not parsed.

### Pagination

`steam_get_library`, `steam_get_achievements`, `steam_get_friends`, and
`steam_get_wishlist` return `nextCursor` when more data exists. Pass that exact
opaque value as `cursor` on the next call. Cursors are URL-safe strings with a
maximum length of 512; clients must not parse or modify them.

A cursor is bound to the parameters that determine its result set. Changing the
user, filters, sort, app, achievement state, or friend-presence choice while
reusing a cursor returns `INVALID_INPUT`. An out-of-range or malformed cursor
also returns `INVALID_INPUT`. Pagination reflects a fresh upstream view; the
server does not retain a snapshot or cached page between calls.

## `steam_get_player`

Gets one public Steam profile, presence/current-game facts, and ban summary.

Input:

```text
{ user?: SteamUserReference }
```

Output data:

```text
{
  steamId: SteamID64,
  profile: PlayerSummary,
  bans: {
    steamId: SteamID64,
    communityBanned: boolean,
    vacBanCount: integer >= 0,
    gameBanCount: integer >= 0,
    economyBan: "none" | "probation" | "banned"
  }
}
```

Source tier: `supported`. A missing profile returns `NOT_FOUND`; a missing ban
summary is an upstream failure rather than invented data.

## `steam_get_library`

Gets a filtered, sorted page from a public owned-game library.

Input:

```text
{
  user?: SteamUserReference,
  limit?: integer 1..configured maximum,       // default 20
  cursor?: OpaqueCursor,
  query?: trimmed string up to 100 characters,
  played?: "all" | "played" | "unplayed",     // default "all"
  sortBy?: "name" | "playtime" | "recent",   // default "name"
  sortDirection?: "asc" | "desc"              // default "asc"
}
```

Output data:

```text
{
  steamId: SteamID64,
  games: OwnedGame[],
  totalCount: integer >= 0,
  nextCursor?: OpaqueCursor
}
```

`query` is a case-insensitive substring match on available game names. Played
means total playtime is greater than zero. Sorting has an app-ID tie breaker for
deterministic pages. Source tier: `supported`. A hidden library returns
`PROFILE_PRIVATE`.

## `steam_get_recent_activity`

Gets a bounded recent-games list and current activity. It is intentionally not
cursor-paginated.

Input:

```text
{
  user?: SteamUserReference,
  limit?: integer 1..configured maximum        // default 20
}
```

Output data:

```text
{
  steamId: SteamID64,
  recentGames: OwnedGame[],
  currentActivity:
    | { status: "playing", appId: AppId, onlineState?: OnlineState }
    | { status: "not_playing", onlineState?: OnlineState }
    | { status: "unavailable" }
}
```

Source tier: `supported`. If the recent-games source succeeds but profile
presence fails, the tool returns `currentActivity.status: "unavailable"` with
`meta.partial: true`. A hidden recent-games list returns `PROFILE_PRIVATE`.

## `steam_get_achievements`

Gets a page of achievement progress for one public player and exact app ID.

Input:

```text
{
  user?: SteamUserReference,
  appId: integer 1..4294967295,
  limit?: integer 1..configured maximum,       // default 20
  cursor?: OpaqueCursor,
  state?: "all" | "locked" | "unlocked"       // default "all"
}
```

Output data:

```text
{
  steamId: SteamID64,
  appId: AppId,
  achievements: [{
    apiName: non-empty string,
    displayName?: string,
    description?: string,
    achieved: boolean,
    unlockedAt?: ISO-8601 UTC timestamp,
    globalPercent?: number 0..100
  }],
  totalCount: integer >= 0,
  nextCursor?: OpaqueCursor
}
```

Source tier: `supported`. Display metadata and global percentages are optional
enrichments. If either enrichment fails, progress remains usable and the result
is partial with a warning. A game with no exposed achievements returns a
successful empty collection with a warning. Hidden progress returns
`PROFILE_PRIVATE`.

## `steam_get_friends`

Gets a page from a public friend list, with optional bounded profile/presence
enrichment.

Input:

```text
{
  user?: SteamUserReference,
  limit?: integer 1..configured maximum,       // default 20
  cursor?: OpaqueCursor,
  includePresence?: boolean                    // default false
}
```

Without enrichment, each output item is:

```text
{ steamId: SteamID64, friendsSince?: ISO-8601 UTC timestamp }
```

With `includePresence: true`, each item is:

```text
{
  relationship: FriendRelationship,
  enrichment:
    | { status: "available", profile: PlayerSummary }
    | { status: "unavailable" }
    | { status: "fan_out_limited" }
}
```

Output data also contains `steamId`, `totalCount`, and optional `nextCursor`.
Source tier: `supported`. Enrichment is capped by the configured fan-out limit,
20 at baseline. Excess items are marked `fan_out_limited`. An enrichment failure
preserves the relationship page, marks attempted entries unavailable, and
returns a partial result. A hidden friend list returns `PROFILE_PRIVATE`.

## `steam_get_wishlist`

Gets a page from a public wishlist with current regional store facts.

Input:

```text
{
  user?: SteamUserReference,
  limit?: integer 1..configured maximum,       // default 20
  cursor?: OpaqueCursor
}
```

Output data:

```text
{
  steamId: SteamID64,
  items: [{
    appId: AppId,
    name?: string,
    available: boolean,
    price?: Price,
    discountPercent?: integer 0..100
  }],
  totalCount: integer >= 0,
  nextCursor?: OpaqueCursor
}
```

Source tier: `best_effort`. The adapter discards out-of-page items even if the
upstream response includes the full ID list. An ambiguous empty response is not
treated as proof of an empty public wishlist. Hidden/unavailable data returns
`PROFILE_PRIVATE`; incompatible upstream pagination returns
`BEST_EFFORT_SOURCE_CHANGED`.

## `steam_search_games`

Searches Steam's store for bounded app candidates. This is a resolver, not a
generic search or recommendation tool.

Input:

```text
{
  query: trimmed string with 1..100 characters,
  limit?: integer 1..10                        // default 10
}
```

Output data:

```text
{
  query: string,
  candidates: [{
    appId: AppId,
    name: non-empty string,
    releaseDate?: string,
    imageUrl?: URL,
    price?: Price,
    originalPrice?: Price,
    discountPercent?: integer 0..100,
    platforms?: { windows: boolean, mac: boolean, linux: boolean },
    metascore?: integer 0..100,
    controllerSupport?: string
  }]
}
```

Source tier: `best_effort`. Ranking is Steam's undocumented store order. The
tool does not analyze candidates, recommend a game, or compare players.

## `steam_get_game`

Gets required store details for an exact app ID plus only explicitly selected
optional facets.

Input:

```text
{
  appId: integer 1..4294967295,
  facets?: unique subset of [                  // default []
    "reviews",
    "current_players",
    "deck_compatibility",
    "news",
    "global_achievements"
  ]
}
```

Output data:

```text
{
  appId: AppId,
  facets: {
    storeDetails: {
      appId: AppId,
      name: non-empty string,
      shortDescription?: string,
      developers: string[],
      publishers: string[],
      genres: string[],
      categories: string[],
      price?: Price,
      originalPrice?: Price,
      discountPercent?: integer 0..100,
      releaseDate?: string
    },
    reviews?: {
      totalPositive: integer >= 0,
      totalNegative: integer >= 0,
      scoreDescription?: string
    },
    currentPlayers?: integer >= 0,
    deckCompatibility?: {
      category: "unknown" | "unsupported" | "playable" | "verified",
      summary?: string
    },
    news?: [{
      id: non-empty string,
      title: non-empty string,
      url: URL,
      publishedAt: ISO-8601 UTC timestamp
    }],
    globalAchievements?: {
      definitions: [{
        apiName: non-empty string,
        displayName?: string,
        description?: string,
        hidden: boolean,
        iconUrl?: URL,
        lockedIconUrl?: URL
      }],
      percentages: [{ apiName: non-empty string, globalPercent: number 0..100 }]
    }
  },
  unavailableFacets: [{
    facet: selected facet name,
    sourceTier: "supported" | "best_effort" | "derived",
    code: stable error code
  }]
}
```

Store details are always fetched and are a required `best_effort` identity
anchor; a missing app returns `NOT_FOUND`. `reviews` and `deck_compatibility`
are optional best-effort facets. Their failure preserves the store result,
records an `unavailableFacets` entry, and sets `meta.partial: true`. The
`current_players`, `news`, and `global_achievements` facets use supported Steam
Web API operations and their failures are terminal. Unselected facets are not
fetched.

The tool reports Steam facts only. It does not rank games, recommend what to
play, plan a game night, compare players, modify Steam data, link accounts, or
delete accounts.
