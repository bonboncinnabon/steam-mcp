## ADDED Requirements

### Requirement: Steam credential separation

Hosted Steam requests MUST use the service-owned credential and local Steam
requests MUST use the environment-provided credential; neither credential SHALL
be accepted through MCP tool arguments.

#### Scenario: Tool input contains key-like unknown field

- **WHEN** a caller includes a Steam API key or other unknown field in tool
  input
- **THEN** schema validation rejects the input before the value can reach
  logging or the upstream client

#### Scenario: Credential-bearing upstream failure

- **WHEN** Steam returns an error for a request containing a credential
- **THEN** the tool error, logs, traces, cache keys, and metrics exclude the
  credential and credential-bearing URL

### Requirement: Allowlisted HTTPS upstreams

The system MUST issue outbound Steam requests only over HTTPS to explicitly
configured Steam-operated hosts and MUST revalidate every redirect target.

#### Scenario: Allowed Steam endpoint

- **WHEN** a typed adapter requests its declared HTTPS path on an allowlisted
  host
- **THEN** the shared HTTP boundary permits the request subject to policy

#### Scenario: Redirect to unapproved host

- **WHEN** an allowed endpoint redirects to a host outside the allowlist
- **THEN** the system blocks the redirect and returns a sanitized upstream error

### Requirement: Source-tier declaration

Every successful tool result SHALL identify whether its facts came from
`supported`, `best_effort`, or `derived` sources.

#### Scenario: Mixed-source result

- **WHEN** a composite tool uses documented Steam facts and a derived analysis
- **THEN** `meta.source_tiers` contains both `supported` and `derived`

### Requirement: Stable result envelope

Every tool SHALL return a versioned structured success or error envelope and
concise text derived from that same result.

#### Scenario: Structured success

- **WHEN** a tool completes successfully
- **THEN** structured content contains `ok: true`, `data`, and metadata with
  schema version, source tiers, partial state, and warnings

#### Scenario: Expected tool failure

- **WHEN** a tool encounters a validation, privacy, quota, not-found, or
  upstream execution failure
- **THEN** it sets MCP `isError: true` and returns `ok: false` with a stable
  code, actionable message, and retryable flag

### Requirement: Stable error taxonomy

The system SHALL restrict public v1 execution errors to `INVALID_INPUT`,
`IDENTITY_NOT_LINKED`, `PROFILE_PRIVATE`, `NOT_FOUND`, `STEAM_AUTH_FAILED`,
`STEAM_RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`, `BEST_EFFORT_SOURCE_CHANGED`,
`USER_QUOTA_EXCEEDED`, and `INTERNAL_ERROR`.

#### Scenario: Unexpected internal exception

- **WHEN** an unclassified internal exception reaches the tool boundary
- **THEN** the system returns sanitized `INTERNAL_ERROR` and records only
  redacted diagnostic context

### Requirement: Retry classification

The system SHALL retry only configured transient network failures, HTTP 429
responses, and selected HTTP 5xx responses using bounded exponential backoff
with jitter and applicable upstream retry guidance.

#### Scenario: Transient server failure then success

- **WHEN** an idempotent Steam request receives a configured retryable 5xx
  response followed by success within the attempt limit
- **THEN** the system returns the successful normalized result after the bounded
  retry

#### Scenario: Authentication failure

- **WHEN** Steam rejects the application credential
- **THEN** the system returns `STEAM_AUTH_FAILED` without retrying

#### Scenario: Retry budget exhausted

- **WHEN** all configured attempts receive retryable failures
- **THEN** the system returns the applicable sanitized rate-limit or unavailable
  error and performs no additional attempts

### Requirement: Atomic quota reservation

Hosted mode MUST reserve global and per-user quota atomically before starting
uncached upstream work and MUST preserve a configurable global safety reserve.

#### Scenario: User quota exhausted

- **WHEN** a user lacks sufficient remaining quota for a requested operation
- **THEN** the system returns `USER_QUOTA_EXCEEDED` before acquiring concurrency
  or calling Steam

#### Scenario: Global reserve reached

- **WHEN** the remaining global budget equals the configured safety reserve
- **THEN** the system rejects additional non-reserved upstream work without
  overspending the budget across instances

### Requirement: Bounded concurrency and fan-out

The system SHALL enforce configured per-host, per-operation, per-tool fan-out,
page, execution-time, and output-size limits.

#### Scenario: Friend enrichment exceeds fan-out bound

- **WHEN** a friend page contains more entries than the enrichment fan-out limit
- **THEN** the system enriches only the allowed bounded set and reports the
  remaining entries without unbounded parallel requests

#### Scenario: Execution deadline reached

- **WHEN** a tool reaches its configured execution deadline
- **THEN** the system cancels outstanding upstream work and returns a sanitized
  retryable error or partial result according to the tool contract

### Requirement: Safe caching and request coalescing

The system SHALL cache only explicitly eligible non-sensitive public game or
store data and SHALL coalesce identical eligible in-flight reads.

#### Scenario: Identical concurrent public requests

- **WHEN** multiple callers request the same eligible public data while the
  first request is in flight
- **THEN** the system performs one upstream request and shares the validated
  result without sharing tenant-specific state

#### Scenario: User payload offered to cache

- **WHEN** a library, friend, achievement, activity, wishlist, credential,
  prompt, or tool-argument payload reaches the cache policy
- **THEN** the policy rejects durable caching of that payload by default

### Requirement: Best-effort drift detection

Every best-effort adapter SHALL validate its observed upstream contract and
SHALL fail independently when that contract changes.

#### Scenario: Best-effort response shape changes

- **WHEN** a best-effort endpoint returns a response that fails its adapter
  schema
- **THEN** the adapter returns `BEST_EFFORT_SOURCE_CHANGED`, emits a bounded
  drift metric, and excludes the raw body from output and telemetry

### Requirement: Canonical data representation

The system SHALL represent Steam IDs as strings, money as integer minor units
plus ISO currency when known, and public timestamps as ISO 8601 UTC strings.

#### Scenario: SteamID64 normalization

- **WHEN** Steam returns a 64-bit identity value
- **THEN** the normalized result preserves the exact decimal value as a string
  without numeric precision loss
