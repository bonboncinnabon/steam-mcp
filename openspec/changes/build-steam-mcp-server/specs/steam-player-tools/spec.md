## ADDED Requirements

### Requirement: Player profile tool

The system SHALL expose `steam_get_player` to return normalized public profile,
presence, current-game, visibility, and ban-summary data for one resolved user.

#### Scenario: Public player profile

- **WHEN** a caller requests a public player
- **THEN** the tool returns the resolved SteamID64 and available normalized
  profile facets in the common success envelope

#### Scenario: Unknown player

- **WHEN** the supplied user cannot be resolved to a Steam account
- **THEN** the tool returns `NOT_FOUND` with `isError: true`

### Requirement: Library tool

The system SHALL expose `steam_get_library` to return a bounded,
cursor-paginated public library with playtime and optional recent-play fields,
filtering, and sorting.

#### Scenario: First library page

- **WHEN** a caller requests a public library without a cursor
- **THEN** the tool returns no more than the validated limit, an opaque next
  cursor when more data exists, and stable game identifiers

#### Scenario: Library continuation

- **WHEN** a caller supplies a valid cursor from a prior library response
- **THEN** the tool returns the next deterministic page without repeating items
  from the prior page

#### Scenario: Invalid library limit

- **WHEN** a caller supplies a limit outside the documented bounds
- **THEN** schema validation returns `INVALID_INPUT` before invoking Steam

### Requirement: Recent activity tool

The system SHALL expose `steam_get_recent_activity` to return bounded recently
played games and available public current activity for one resolved user.

#### Scenario: No recent games

- **WHEN** Steam reports a public user with no games played in the recent period
- **THEN** the tool returns a successful empty recent-games collection distinct
  from a private profile error

### Requirement: Achievement tool

The system SHALL expose `steam_get_achievements` to return cursor-paginated
locked and unlocked achievements for one resolved user and game, enriched with
global rarity when available.

#### Scenario: Achievement progress

- **WHEN** a user’s achievement data for the requested game is public
- **THEN** the tool returns stable achievement identifiers, unlock state,
  available unlock time, and available global rarity

#### Scenario: Game has no achievement data

- **WHEN** Steam exposes no achievements for the requested game
- **THEN** the tool returns a successful empty collection with an explanatory
  warning

### Requirement: Friends tool

The system SHALL expose `steam_get_friends` to return a bounded,
cursor-paginated public friend list with optional bounded presence enrichment.

#### Scenario: Enriched friend page

- **WHEN** a caller requests presence enrichment for a public friend list
- **THEN** the tool enriches no more than the documented fan-out limit and
  reports unavailable entries explicitly

#### Scenario: Private friend list

- **WHEN** the resolved user does not expose friends publicly
- **THEN** the tool returns `PROFILE_PRIVATE` rather than an empty success

### Requirement: Wishlist tool

The system SHALL expose `steam_get_wishlist` to return a bounded,
cursor-paginated wishlist with current availability, integer minor-unit price,
ISO currency, and discount data when the best-effort Steam source is available.

#### Scenario: Available wishlist source

- **WHEN** the public Steam wishlist source returns valid data
- **THEN** the tool returns the wishlist with `best_effort` included in
  `meta.source_tiers`

#### Scenario: Wishlist source contract drift

- **WHEN** the public Steam wishlist source no longer matches its validated
  contract
- **THEN** the tool returns `BEST_EFFORT_SOURCE_CHANGED` without exposing the
  raw upstream response

### Requirement: Player-tool identity behavior

Every subject-oriented player tool SHALL use the common identity-resolution
order and SHALL NOT read or mutate account identity state.

#### Scenario: Explicit public-profile research

- **WHEN** an authorized remote caller invokes any player tool with an explicit
  public profile
- **THEN** the tool uses that profile for the call without account persistence
