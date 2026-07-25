## ADDED Requirements

### Requirement: Minimal remote data retention

The remote MCP server SHALL create no user account record and SHALL NOT durably
retain bearer credentials, Steam identities, Steam responses, prompts, or tool
arguments. Quota storage is limited to bounded instance counters and rollover
metadata.

#### Scenario: Remote player-tool completion

- **WHEN** a remote player tool returns library, friend, achievement, activity,
  or wishlist data
- **THEN** the system does not durably store the Steam response, prompt, or tool
  arguments by default

#### Scenario: Account lifecycle request

- **WHEN** a caller asks the MCP server to create, link, revoke, or delete an
  account
- **THEN** the MCP server exposes no account lifecycle or mutation tool

### Requirement: Secret and personal-data redaction

The system MUST exclude Steam API keys, remote bearer tokens, credential-bearing
URLs, raw upstream bodies, prompts, tool arguments, and unapproved personal
payloads from logs, traces, metrics, fixtures, errors, and quota keys.

#### Scenario: Error contains a secret

- **WHEN** an upstream or dependency error message includes a configured secret
- **THEN** the observability and public-error boundaries replace or remove the
  secret before emitting any output

#### Scenario: Test fixture capture

- **WHEN** a live upstream response is converted into a test fixture
- **THEN** automated validation rejects the fixture if it contains credentials
  or unapproved personal identifiers

### Requirement: Bounded observability

The system SHALL expose metrics and redacted structured events using bounded
labels such as tool name, stable error code, source tier, and HTTP status class.

#### Scenario: Tool execution metric

- **WHEN** a tool call completes
- **THEN** metrics record bounded outcome and latency dimensions without raw
  user identifiers or tool arguments

### Requirement: Validated startup configuration

Remote and local executable modes MUST validate required configuration, types,
bounds, and incompatible combinations before accepting work.

#### Scenario: Invalid quota configuration

- **WHEN** remote startup receives a negative quota or a global safety reserve
  larger than the daily budget
- **THEN** startup fails with a redacted actionable diagnostic rather than
  silently selecting defaults

### Requirement: Graceful remote shutdown

The remote system SHALL stop accepting new work, drain active requests within a
configured deadline, cancel remaining upstream calls, and close transport plus
configured quota clients.

#### Scenario: Shutdown with active tool calls

- **WHEN** the process receives a termination signal while tool calls are active
- **THEN** it marks readiness false, rejects new work, allows bounded draining,
  and exits without leaving accepted requests indefinitely pending

### Requirement: Backward-compatible deployment and rollback

Remote deployments SHALL use versioned artifacts with staged rollout and
rollback.

#### Scenario: Application rollback

- **WHEN** a new version fails its rollout gates
- **THEN** operations can restore the previous versioned artifact without a data
  migration

#### Scenario: Best-effort adapter incident

- **WHEN** one best-effort adapter causes elevated failures
- **THEN** operations can disable that adapter or facet without rolling back
  unrelated documented tools

### Requirement: Strict test-driven implementation

Every production behavior and bug fix MUST be preceded by one focused test that
is observed failing for the intended reason, followed by minimal implementation,
a passing focused test, refactoring, and the passing affected suite.

#### Scenario: New behavior implementation

- **WHEN** an engineer begins a new observable behavior
- **THEN** fresh evidence shows the focused test’s intended red failure before
  production code for that behavior is written

#### Scenario: Regression fix

- **WHEN** an engineer fixes a defect
- **THEN** a focused regression test reproduces the defect before the fix and
  remains passing afterward

### Requirement: Verification quality gates

CI SHALL require strict type checking, linting, formatting, unit tests, contract
tests, dependency auditing, at least 90 percent overall line and branch
coverage, and complete high-risk branch coverage with targeted mutation or fault
injection.

#### Scenario: Coverage regression

- **WHEN** a change lowers overall line or branch coverage below 90 percent
- **THEN** CI fails even when all executed tests pass

#### Scenario: High-risk module verification

- **WHEN** bearer authorization, bearer/Steam-credential separation, secret
  redaction, quota accounting, or host enforcement changes
- **THEN** CI requires 100 percent branch coverage for the affected high-risk
  behavior plus its configured mutation or fault-injection checks

### Requirement: Layered release verification

A remote release SHALL require protocol, bearer authorization, quota,
concurrency, shutdown, cross-client, and rollback evidence in addition to unit
and contract tests.

#### Scenario: Release candidate missing cross-client evidence

- **WHEN** a remote release candidate has not passed the supported-client smoke
  matrix
- **THEN** the release gate fails regardless of unit-test coverage

### Requirement: Public engineering documentation

The repository SHALL document architecture, tool contracts, source tiers, remote
and local setup, bearer and Steam credential boundaries, security, privacy,
testing, contribution rules, operations, versioning, and changes.

#### Scenario: Clean-environment documentation check

- **WHEN** release documentation is verified from a clean supported environment
- **THEN** remote and local setup paths complete without relying on undocumented
  maintainer knowledge
