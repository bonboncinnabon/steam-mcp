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
operator-configured `STEAM_USER` second, and otherwise return
`IDENTITY_NOT_LINKED`. In remote mode the configured default is instance-wide;
the remote bearer credential SHALL NOT be treated as a Steam identity.

#### Scenario: Explicit remote identity

- **WHEN** an authorized remote caller supplies an explicit public user
- **THEN** the system executes the call for that user without reading or writing
  account identity state

#### Scenario: Configured default identity

- **WHEN** a local or authorized remote caller omits `user` and the operator
  configures `STEAM_USER`
- **THEN** the system executes the call for that configured public user

#### Scenario: Missing identity default

- **WHEN** a subject-oriented call omits `user` and the operator has not
  configured `STEAM_USER`
- **THEN** the system returns `IDENTITY_NOT_LINKED` with corrective guidance and
  performs no Steam request

#### Scenario: Shared remote default

- **WHEN** multiple authorized callers omit `user` on one private remote
  instance with `STEAM_USER` configured
- **THEN** every caller observes the same operator-configured default without
  creating, updating, or persisting caller-specific identity state

### Requirement: Public-data privacy behavior

Identity resolution SHALL NOT imply access to private Steam fields and SHALL
preserve Steam’s reported privacy restrictions.

#### Scenario: Private library

- **WHEN** a resolved Steam user does not expose the requested library data
  publicly
- **THEN** the system returns `PROFILE_PRIVATE` rather than an empty success
  that could be mistaken for no games
