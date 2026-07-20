## ADDED Requirements

### Requirement: Accepted Steam user references

The system SHALL accept a SteamID64, Steam vanity name, or allowlisted Steam
Community profile URL anywhere a tool accepts an explicit `user` value.

#### Scenario: SteamID64 reference

- **WHEN** a caller supplies a syntactically valid SteamID64
- **THEN** the system preserves it as a string and uses it as the resolved Steam
  identity

#### Scenario: Vanity-name reference

- **WHEN** a caller supplies a valid vanity name
- **THEN** the system resolves it through the typed Steam identity adapter
  before executing the requested behavior

#### Scenario: Disallowed profile host

- **WHEN** a caller supplies a profile URL whose host is not an allowlisted
  Steam Community host
- **THEN** the system returns `INVALID_INPUT` without following or requesting
  that URL

### Requirement: Deterministic identity resolution order

Subject-oriented tools SHALL resolve identity from explicit tool input first,
the authenticated account’s linked SteamID64 second, local `STEAM_USER` third,
and otherwise return `IDENTITY_NOT_LINKED`.

#### Scenario: Explicit identity overrides linked identity

- **WHEN** a hosted user with a linked SteamID64 supplies a different explicit
  public user
- **THEN** the system executes the call for the explicit user without altering
  the linked identity

#### Scenario: Linked identity supplies hosted default

- **WHEN** an authenticated hosted user omits `user` and has a linked SteamID64
- **THEN** the system executes the call for that linked SteamID64

#### Scenario: Missing identity default

- **WHEN** a subject-oriented call omits `user` and no hosted or local default
  is available
- **THEN** the system returns `IDENTITY_NOT_LINKED` with corrective guidance and
  performs no Steam request

### Requirement: Optional Steam identity linking

The hosted system SHALL allow an authenticated account to link one SteamID64
through a browser-based Steam OpenID verification flow.

#### Scenario: Successful verified link

- **WHEN** Steam OpenID verifies a SteamID64 for the authenticated account and
  state validation succeeds
- **THEN** the system stores that SteamID64 as the account’s linked default

#### Scenario: Unverified link attempt

- **WHEN** a link request lacks valid Steam OpenID verification or has invalid
  state
- **THEN** the system rejects the link and leaves the account unchanged

### Requirement: Link lifecycle

An authenticated account SHALL be able to replace or unlink its own linked
SteamID64, and those actions SHALL affect subsequent default resolution.

#### Scenario: Unlink identity

- **WHEN** an authenticated account unlinks its Steam identity
- **THEN** the system removes the stored link and later omitted-user calls no
  longer resolve to that SteamID64

#### Scenario: Replace identity

- **WHEN** an authenticated account completes verification for a new SteamID64
- **THEN** the system replaces the prior default without retaining it as an
  active link

### Requirement: Tenant-isolated identity records

The system MUST scope every linked Steam identity read and mutation to the
authenticated authorization subject.

#### Scenario: Cross-account link access

- **WHEN** one authenticated account attempts to read, replace, or unlink
  another account’s Steam identity record
- **THEN** the system denies the operation and does not reveal whether the other
  link exists

### Requirement: Public-data privacy behavior

Identity resolution SHALL NOT imply access to private Steam fields and SHALL
preserve Steam’s reported privacy restrictions.

#### Scenario: Private library

- **WHEN** a resolved Steam user does not expose the requested library data
  publicly
- **THEN** the system returns `PROFILE_PRIVATE` rather than an empty success
  that could be mistaken for no games
