## ADDED Requirements

### Requirement: Game search tool

The system SHALL expose `steam_search_games` to rank bounded Steam app
candidates for a natural-language game query and return evidence sufficient to
disambiguate similarly named titles.

#### Scenario: Ambiguous title search

- **WHEN** a query matches multiple Steam apps
- **THEN** the tool returns ranked candidates with stable app IDs, titles, and
  available distinguishing metadata rather than silently choosing one

#### Scenario: Blank search query

- **WHEN** a caller supplies a blank or whitespace-only query
- **THEN** the tool returns `INVALID_INPUT` without invoking an upstream source

### Requirement: Consolidated game-details tool

The system SHALL expose `steam_get_game` with explicit bounded facet selection
for store details, reviews, current player count, Steam Deck compatibility,
news, and global achievement information.

#### Scenario: Default game overview

- **WHEN** a caller requests a valid app ID without explicit facets
- **THEN** the tool returns the documented compact default facets without
  fetching every optional source

#### Scenario: Selected facets

- **WHEN** a caller selects an allowed set of detail facets
- **THEN** the tool fetches only those facets and identifies their source tiers
  in the result metadata

#### Scenario: Unknown facet

- **WHEN** a caller requests a facet outside the declared enum
- **THEN** schema validation returns `INVALID_INPUT` before upstream work

### Requirement: Partial game-detail results

The game-details tool SHALL preserve successful facets when one or more optional
sources fail and SHALL identify each unavailable facet.

#### Scenario: Best-effort reviews unavailable

- **WHEN** documented store details succeed but the best-effort reviews source
  fails validation
- **THEN** the tool returns the store details with `meta.partial` set to true
  and a warning identifying reviews as unavailable

#### Scenario: Required app identity unavailable

- **WHEN** the requested app ID cannot be resolved to a Steam app
- **THEN** the tool returns `NOT_FOUND` rather than a partial success

### Requirement: Explainable recommendation tool

The system SHALL expose `steam_recommend_games` to produce bounded
recommendations from an explicit or default player, seed games, and validated
constraints.

#### Scenario: Player-based recommendations

- **WHEN** a caller requests recommendations for a public library
- **THEN** each recommendation identifies the library facts, seed similarities,
  tags, constraints, or ownership exclusions that caused it to be selected

#### Scenario: Seed-only recommendations

- **WHEN** a caller supplies seed games without a player identity
- **THEN** the tool can recommend from available public game facts without
  returning `IDENTITY_NOT_LINKED`

#### Scenario: Ownership exclusion

- **WHEN** ownership exclusion is requested and a public library is available
- **THEN** the tool excludes owned app IDs from the recommendation set

### Requirement: Recommendation truthfulness

The recommendation tool MUST distinguish deterministic heuristics from upstream
facts and MUST NOT claim collaborative, learned, or personalized behavior that
was not performed.

#### Scenario: Heuristic recommendation result

- **WHEN** recommendations are produced from rule-based similarity and
  constraints
- **THEN** the result labels them as derived and explains the applied rule-based
  evidence
