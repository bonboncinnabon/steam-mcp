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

The system SHALL expose `steam_get_game` with required store details as the app
identity anchor and explicit bounded selection for the optional reviews,
current-player-count, Steam Deck compatibility, news, and global-achievement
facets. The global-achievement facet includes both achievement definitions and
global unlock percentages.

#### Scenario: Default game overview

- **WHEN** a caller requests a valid app ID without explicit facets
- **THEN** the tool returns store details only and fetches no optional source

#### Scenario: Selected facets

- **WHEN** a caller selects an allowed set of optional detail facets
- **THEN** the tool fetches required store details plus only those selected
  optional facets and identifies their source tiers in the result metadata

#### Scenario: Unknown facet

- **WHEN** a caller requests a facet outside the declared enum
- **THEN** schema validation returns `INVALID_INPUT` before upstream work

### Requirement: Partial game-detail results

The game-details tool SHALL preserve successful facets when one or more selected
optional best-effort sources fail and SHALL identify each unavailable facet.
Failures from selected supported Steam Web API facets remain terminal.

#### Scenario: Optional reviews unavailable

- **WHEN** store details succeed but the optional best-effort reviews source
  fails validation
- **THEN** the tool returns the store details with `meta.partial` set to true
  and a warning identifying reviews as unavailable

#### Scenario: Required app identity unavailable

- **WHEN** required store details cannot resolve the requested app ID
- **THEN** the tool returns `NOT_FOUND` rather than a partial success

#### Scenario: Selected supported facet fails

- **WHEN** a selected supported Steam Web API facet fails
- **THEN** the tool returns the supported-source failure rather than
  misrepresenting it as an optional partial result

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
