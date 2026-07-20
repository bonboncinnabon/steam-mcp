# Steam MCP Server Design

- **Date:** 2026-07-20
- **Status:** Approved design; written specification pending user review
- **Primary delivery:** Hosted remote MCP server with OAuth
- **Secondary delivery:** Local and self-hosted `stdio` server with
  bring-your-own Steam API key

## 1. Purpose

Build a reliable, read-only Steam MCP server for personal use and public
distribution. The hosted product must require no local installation or Steam API
key from ordinary users. It must support both account-aware requests such as
“show my library” and explicit public-profile requests using a SteamID64, vanity
name, or profile URL.

The implementation must follow current MCP, OpenAI, and Anthropic conventions,
use strict test-driven development, and keep security, privacy, operational
reliability, and model-facing tool quality as first-class concerns.

## 2. Product Position

The product is a zero-install, account-aware Steam MCP that also works for
arbitrary public Steam research. It is not a Steam client controller, Steamworks
publisher tool, trading system, or generic Steam API proxy.

The closest surveyed general-purpose competitor is `Sarg338/steam-mcp`, which
provides broad local, read-only Steam coverage using a user-supplied key. Other
surveyed projects focus on local Steam installation management, Steamworks
development, narrow library access, or commercial API documentation. The
differentiating combination is:

- A hosted Streamable HTTP endpoint protected by standards-compliant MCP OAuth.
- Optional linked Steam identity for natural “me” and “my” semantics.
- Explicit lookup of any public Steam profile.
- A small task-oriented tool surface instead of a raw endpoint catalog.
- Structured, bounded, model-friendly results.
- Cross-client verification and published operational quality.
- An open-source local/self-hosted fallback.

OAuth alone is not treated as a durable advantage. The product must combine
low-friction access with strong composite behaviors, identity-aware defaults,
predictable contracts, and substantially better reliability evidence.

## 3. Scope

### 3.1 In scope for v1

- Read-only Steam player, library, activity, achievement, friend, wishlist,
  store, search, and recommendation workflows.
- Hosted Streamable HTTP transport.
- Local `stdio` transport.
- OAuth 2.1 authorization for the hosted MCP endpoint.
- Optional Steam identity linking through Steam OpenID.
- A service-owned Steam Web API key for hosted calls.
- A user-supplied `STEAM_API_KEY` for local and self-hosted calls.
- Documented Steam Web API endpoints and isolated best-effort Steam-operated
  public endpoints.
- Per-user quotas, upstream rate protection, caching, observability, and privacy
  controls.

### 3.2 Out of scope for v1

- Game-night planning and player-comparison tools.
- Trades, purchases, market transactions, account changes, messaging, posting,
  or game launching.
- Steamworks publisher-only operations.
- Remote bring-your-own-key storage.
- Steam password collection or storage.
- Bypassing private profiles or other Steam privacy controls.
- A generic `call_steam_api` escape hatch.
- Automatically generating MCP tools from OpenAPI or Steam interface catalogs.
- Scraping non-Steam sites.

## 4. Engineering Principles

The implementation must follow these constraints:

- Fix root causes rather than symptoms.
- Preserve clear dependency direction toward the domain.
- Keep modules small, cohesive, and independently testable.
- Centralize behavioral values such as timeouts, retry limits, page limits,
  quotas, and cache policies.
- Define explicit contracts at every boundary.
- Prefer typed adapters over speculative abstractions.
- Keep secrets and personal data out of logs, fixtures, errors, and
  configuration committed to Git.
- Add comments only for non-obvious invariants, protocol constraints, and
  Steam-specific behavior.
- Verify narrowly first, then broaden checks in proportion to risk.
- Never claim completion without fresh test and verification evidence.

## 5. System Architecture

The application core is independent of MCP transports, OAuth, storage
technology, and the concrete HTTP client.

```text
MCP clients
  |-- Streamable HTTP --> OAuth resource boundary --|
  |-- stdio ----------------------------------------|--> MCP tools
                                                        |
                                                        v
                                                Domain services
                                                  |         |
                                                  v         v
                                            Steam gateway  Identity/quota/cache ports
                                                  |
                                                  v
                                           Allowlisted Steam hosts
```

### 5.1 Modules

`domain` : Normalized Steam identifiers, entities, result types, error codes,
and pure business rules. It has no dependency on MCP, HTTP, OAuth, databases, or
environment variables.

`steam-client` : Typed upstream operations, response validation, host
allowlisting, credential injection, timeout handling, retry classification, and
Steam-specific normalization. Documented and best-effort endpoints use separate
adapters.

`services` : Application behaviors that compose upstream operations, including
library analysis and explainable recommendations. Services depend on domain
contracts and ports, not transport implementations.

`mcp-tools` : Tool names, descriptions, input schemas, output schemas,
annotations, bounded defaults, and mapping between MCP results and application
services.

`identity` : Resolves the authenticated account, optional linked SteamID64,
explicit user references, and local `STEAM_USER` defaults. It enforces tenant
isolation.

`transports/http` : Stateless Streamable HTTP endpoint, OAuth resource-server
enforcement, Origin and Host validation, health endpoints, graceful shutdown,
and request correlation.

`transports/stdio` : Local adapter that reads credentials from the process
environment and writes only MCP protocol messages to stdout. Logs go to stderr.

`storage` : Ports and hosted implementations for identities, consent state,
quotas, caches, and security audit records. Hosted deployment uses PostgreSQL
for durable account metadata and Redis-compatible storage for quotas and
short-lived caches. Local mode uses bounded in-memory implementations and stores
no account data.

`observability` : Redacted structured logging, metrics, traces, health
reporting, and request correlation. It must not record tool arguments or Steam
payloads by default.

## 6. Identity and Authorization

### 6.1 MCP authorization

The hosted MCP server acts only as an OAuth 2.1 resource server. Deployment
supplies an external authorization server supporting:

- OAuth Protected Resource Metadata.
- OAuth/OIDC authorization-server discovery.
- Authorization Code with PKCE using `S256`.
- Resource Indicators and audience-bound access tokens.
- Exact redirect URI validation.
- Short-lived access tokens and revocation.
- A client-registration path compatible with supported MCP clients, using Client
  ID Metadata Documents or Dynamic Client Registration as applicable.

The MCP service validates issuer, signature, audience, expiry, scopes, and token
status. It never passes an MCP access token to Steam or another upstream
service.

### 6.2 Steam identity

Steam OpenID proves a Steam identity but does not replace MCP OAuth or grant
general delegated Steam Web API access. A hosted account may link one SteamID64
through a browser-based Steam OpenID flow. The link is optional.

Subject-oriented tools resolve their `user` input in this order:

1. Explicit SteamID64, vanity name, or Steam profile URL supplied to the tool.
2. Hosted account’s linked SteamID64.
3. Local process `STEAM_USER` value.
4. Return `IDENTITY_NOT_LINKED` with corrective guidance.

An explicit user reference never mutates the linked default. Linked identity
records are scoped to the authenticated account, and tests must prove
cross-account isolation.

### 6.3 Steam API credentials

Hosted mode uses one service-owned standard Steam Web API key stored in the
deployment secret manager. Local mode uses `STEAM_API_KEY`. Credentials are
injected as the `x-webapi-key` header where supported and are never accepted as
tool inputs, returned in errors, written to caches, or included in telemetry.

Remote bring-your-own-key storage is deferred beyond v1 because it would create
a high-value third-party credential vault.

## 7. MCP Tool Surface

All tools are read-only and carry accurate MCP annotations. Every tool declares
validated input and output schemas and returns concise text plus structured
content. Tool descriptions state what the tool does, when to use it, significant
limitations, parameter meaning, return shape, and privacy behavior without
unnecessary prose.

### 7.1 Common conventions

- `user` is optional for subject-oriented tools and follows the identity
  resolution order above.
- User identifiers accept SteamID64, vanity name, or an allowlisted Steam
  Community profile URL.
- Collections use opaque cursor pagination and bounded `limit` values.
- Default responses are intentionally compact.
- Optional detail selection uses explicit enums rather than arbitrary field
  expressions.
- Steam IDs remain strings throughout the system.
- Prices include integer minor units and ISO currency codes when known.
- Times use ISO 8601 UTC strings and retain original epoch values only when
  required for contract fidelity.
- Partial results identify unavailable facets and their error codes.

### 7.2 Tools

`steam_get_player` : Resolve a user reference and return normalized public
profile, presence, current-game, visibility, and ban-summary information. It
does not imply access to private profile fields.

`steam_get_library` : Return a cursor-paginated public game library with
playtime and optional recent-play fields. It supports bounded filtering and
sorting without returning an unbounded library payload.

`steam_analyze_library` : Compute playtime distribution, backlog signals,
abandoned-game signals, frequently played genres, and other explicitly
documented heuristics. The response explains each heuristic and distinguishes
facts from derived observations.

`steam_get_recent_activity` : Return recently played games and public current
activity for a user.

`steam_get_achievements` : Return achievement progress for one user and game,
including locked/unlocked state and global rarity where available. Large sets
are paginated.

`steam_get_friends` : Return a cursor-paginated public friend list with bounded
optional presence enrichment. Private or unavailable entries are represented
explicitly.

`steam_get_wishlist` : Return a cursor-paginated wishlist with current price,
availability, and discount data when the relevant public Steam source is
available.

`steam_search_games` : Resolve a natural-language game query into ranked Steam
app candidates. It returns stable identifiers and enough evidence to
disambiguate titles.

`steam_get_game` : Return a consolidated game overview. Callers select bounded
facets from store details, reviews, player count, Steam Deck compatibility,
news, and global achievement information. Optional facet failure produces a
partial result rather than discarding successful facets.

`steam_recommend_games` : Produce explainable recommendations from a linked or
explicit player, seed games, and bounded constraints such as price, platform,
tags, or ownership exclusion. Recommendations identify their evidence and never
claim collaborative or model-based personalization that the implementation does
not perform.

## 8. Upstream Source Policy

Every upstream operation is classified in code and documentation:

`supported` : A documented Steam Web API operation. Contract changes are treated
as regressions and investigated immediately.

`best_effort` : An undocumented but public endpoint operated by Steam on an
allowlisted host. These operations are isolated, use short caches and
conservative request rates, and may return `BEST_EFFORT_SOURCE_CHANGED` without
breaking unrelated tool facets.

`derived` : A result computed by this service from supported or best-effort
facts. Derived results disclose their inputs and relevant heuristics.

Best-effort sources are permitted for wishlist enrichment, store details and
deal fields, Steam Deck information, search, and richer recommendation inputs.
Aggregate reviews use Steam's documented store-review API. Each adapter must
document why it exists, the observed contract, its fallback behavior, and the
fixture or live probe that detects drift.

The outbound HTTP layer permits only HTTPS requests to an explicit Steam host
allowlist. Redirects are revalidated at every hop. Arbitrary URLs, hosts,
methods, and headers never come from model-controlled inputs.

## 9. Results and Errors

All structured tool results use a versioned common envelope:

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

Expected tool failures use `isError: true` and a stable structured error:

```json
{
  "ok": false,
  "error": {
    "code": "PROFILE_PRIVATE",
    "message": "This Steam profile does not expose its game library publicly.",
    "retryable": false
  }
}
```

Stable v1 error codes are:

- `INVALID_INPUT`
- `IDENTITY_NOT_LINKED`
- `PROFILE_PRIVATE`
- `NOT_FOUND`
- `STEAM_AUTH_FAILED`
- `STEAM_RATE_LIMITED`
- `UPSTREAM_UNAVAILABLE`
- `BEST_EFFORT_SOURCE_CHANGED`
- `USER_QUOTA_EXCEEDED`
- `INTERNAL_ERROR`

Raw upstream bodies, secrets, stack traces, internal addresses, and database
details never appear in tool output. Validation, privacy, and authorization
failures are not retried. Retryable network, 429, and selected 5xx failures
receive bounded exponential backoff with jitter and respect upstream retry
guidance.

## 10. Quotas, Caching, and Concurrency

The hosted service protects Valve’s documented daily limit and unpublished
per-endpoint constraints through:

- A global daily call budget with a safety reserve.
- Per-user rolling and daily quotas.
- Per-host and per-operation concurrency limits.
- Request coalescing for identical safe reads.
- Short-lived caching for public game/store data.
- No caching of secrets.
- No persistent caching of user libraries, friends, achievements, activity, or
  wishlist data by default.
- Backpressure before quota exhaustion.

Behavioral values live in typed centralized policy objects and can be overridden
through validated deployment configuration. Invalid configuration fails startup
rather than silently falling back.

## 11. Privacy and Security

The hosted service retains only:

- The authorization-server subject identifier.
- Optional linked SteamID64.
- Consent, link, and revocation state.
- Per-user quota counters.
- Short-lived non-sensitive public-data caches.
- Redacted security and operational telemetry.

It does not persist Steam libraries, friends, achievements, activity, wishlists,
API responses, MCP prompts, or tool arguments by default. Privacy documentation
states what is processed, stored, retained, and deleted. Users can unlink Steam
identity and delete their hosted account metadata.

Required controls include:

- HTTPS only for hosted traffic.
- Origin and Host validation for Streamable HTTP.
- OAuth audience and scope enforcement.
- No token passthrough.
- Secret-manager integration and key rotation.
- SSRF protection and redirect revalidation.
- Strict schema validation with unknown fields rejected.
- Bounded inputs, outputs, fan-out, and execution time.
- Dependency and container scanning.
- Least-privilege deployment identities.
- Redacted audit events for authorization and administrative actions.

## 12. Test-Driven Development

Implementation uses strict one-test-at-a-time Red-Green-Refactor:

1. Define one observable behavior, including inputs, output, and boundary
   conditions.
2. Write one focused test using Arrange-Act-Assert.
3. Run it and record that it fails for the intended behavioral reason.
4. Write only the minimum implementation required to pass.
5. Run the focused test and record the passing result.
6. Refactor for clarity and cohesion without changing behavior.
7. Run the complete affected test suite.
8. Repeat for the next behavior.

No implementation code may be written without a preceding failing test. Bug
fixes begin with a failing regression test. If a test unexpectedly passes before
implementation, it does not establish the intended red state and must be
corrected before proceeding.

### 12.1 Test layers

`domain unit tests` : Pure behavior, identifier parsing, normalization,
pagination rules, heuristics, money/time handling, and error mapping with no
framework or network dependencies.

`schema and contract tests` : Every tool’s valid, invalid, boundary, success,
partial-success, and error envelopes. Contract snapshots must be reviewed rather
than blindly updated.

`upstream adapter tests` : Scrubbed fixtures for successful, empty, malformed,
private, unauthorized, rate-limited, redirected, slow, and unavailable Steam
responses. Tests cover timeout, cancellation, retry, host enforcement, and
secret redaction.

`MCP transport tests` : Initialization, tool discovery, schema correctness,
calls, structured content, `isError`, shutdown, and stdout purity for both
`stdio` and Streamable HTTP.

`OAuth and tenant-isolation tests` : Discovery metadata, PKCE requirements,
issuer, audience, expiry, scope, revocation, malformed tokens, link ownership,
and proof that one account cannot resolve or mutate another account’s linked
identity.

`storage, quota, cache, and concurrency tests` : Atomic quota consumption,
expiry, eviction, request coalescing, stampede resistance, cancellation, partial
upstream failure, and multi-instance correctness.

`live contract tests` : Opt-in tests using a dedicated Steam test account and
key. They verify a minimal supported and best-effort probe set without exposing
credentials or making CI depend on Steam availability.

`cross-client smoke tests` : MCP Inspector plus supported Codex, Claude, and
OpenAI remote-MCP paths. Configuration examples are tested or mechanically
validated where possible.

`load and operational tests` : Startup, health, graceful shutdown, bounded
memory, quota exhaustion, upstream degradation, deployment rollback, and
horizontal statelessness.

### 12.2 Quality gates

- All changed behavior has demonstrated red and green evidence.
- Every public tool has contract tests for success, invalid input,
  privacy/unavailable data, rate limiting, and upstream failure.
- Overall line and branch coverage must remain at least 90 percent.
- Authorization, identity isolation, secret redaction, quota accounting, and
  host enforcement require 100 percent branch coverage plus targeted mutation or
  fault-injection testing.
- Type checking, linting, formatting, unit tests, contract tests, and dependency
  audits run in CI.
- Broader integration, live, cross-client, load, and deployment checks run
  according to their documented cadence and release gate.
- Coverage numbers never substitute for meaningful boundary, concurrency,
  failure, and security assertions.

## 13. Documentation

The repository must include:

- A concise README with hosted, local, and self-hosted quick starts.
- Architecture and data-flow documentation.
- A complete tool reference with inputs, outputs, examples, limits, source
  tiers, and privacy behavior.
- A supported versus best-effort upstream source matrix.
- OAuth and Steam identity-linking documentation.
- Security policy and threat model.
- Privacy policy and data deletion behavior.
- Test strategy and commands for every test tier.
- Contributor guidance enforcing TDD and module boundaries.
- An operational runbook for Steam outages, quota pressure, key rotation,
  auth-provider failure, migration, rollback, and incident response.
- Semantic-versioning and changelog policies for MCP contracts.

Code documentation explains public contracts and non-obvious constraints. It
does not narrate straightforward implementation. Architectural decisions that
affect future contributors are recorded as short decision records.

## 14. Deployment and Operations

The hosted HTTP service is stateless outside PostgreSQL and Redis-compatible
ports and can scale horizontally. It exposes separate liveness and readiness
checks that do not call Steam. Startup validates configuration, schema versions,
OAuth metadata, and required storage connectivity.

Deployments must support:

- Graceful connection draining and cancellation.
- Backward-compatible database migrations.
- Versioned container images and reproducible builds.
- Staged rollout and fast rollback.
- Metrics for request volume, tool latency, upstream status, cache behavior,
  quota consumption, partial results, and error codes.
- Alerts before global Steam quota exhaustion and on best-effort contract drift.

The initial public rollout is quota-limited. Increasing access requires observed
capacity and reliability evidence rather than optimistic assumptions.

## 15. Versioning and Compatibility

The package and server use Semantic Versioning. Within a major version, these
are stable:

- Tool names.
- Input field names, types, requiredness, and documented defaults.
- Structured output field names and types.
- Error codes and their semantics.
- Read-only behavior and identity-resolution order.

Minor versions may add optional inputs, output fields, and tools. Patch versions
fix defects without intentional contract changes. Human-readable text, cache
durations, internal endpoint selection, and implementation structure are not
stable API contracts.

## 16. Acceptance Criteria

V1 is complete only when:

- All ten tools meet their documented contracts over both transports.
- Hosted OAuth passes discovery, PKCE, audience, scope, expiry, revocation, and
  cross-tenant isolation tests.
- Linked and explicit Steam identities resolve according to the defined order.
- The hosted service never requires an ordinary user to provide a Steam API key.
- Local mode works using `STEAM_API_KEY` and optional `STEAM_USER`.
- Documented and best-effort adapters are isolated and visibly classified in
  results.
- Partial optional-source failures do not erase successful data.
- Secrets and private payloads are absent from logs, errors, fixtures, and
  caches.
- Quota and concurrency controls prevent unbounded Steam usage.
- All quality gates pass with fresh evidence.
- Hosted, local, and self-hosted setup documentation has been followed
  successfully from a clean environment.
- Cross-client smoke tests pass for the supported Codex, Claude, OpenAI, and MCP
  Inspector paths.

## 17. Implementation Planning Constraints

The implementation plan must decompose work into small behavioral increments
that each complete a Red-Green-Refactor cycle. Infrastructure scaffolding must
also be test-driven where it has observable behavior. The plan must establish
the domain and test harness before adding transports, upstream adapters,
identity, composite services, hosted persistence, or deployment configuration.

Claude’s handover archive may be used as endpoint research only. Its
implementation is not imported wholesale, and no production behavior is accepted
without a failing test and a reviewed contract.

## 18. Research References

The external guidance and competitor survey were checked on 2026-07-20.
Implementation planning must refresh dependency versions and any guidance likely
to have changed.

Protocol and provider guidance:

- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [Official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [OpenAI MCP and Connectors guide](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [Anthropic MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)
- [Anthropic tool-definition guidance](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)
- [Steam Web API key authentication](https://partner.steamgames.com/doc/webapi_overview/auth)
- [Steam OAuth documentation](https://partner.steamgames.com/doc/webapi_overview/OAuth)
- [Steam Web API Terms of Use](https://steamcommunity.com/dev/apiterms)

Surveyed product references:

- [Sarg338/steam-mcp](https://github.com/Sarg338/steam-mcp)
- [Praeses0/steam-mcp](https://github.com/Praeses0/steam-mcp)
- [TMHSDigital/steam-mcp](https://github.com/TMHSDigital/steam-mcp)
- [jkiley129/steam-mcp](https://github.com/jkiley129/steam-mcp)
- [algorhythmic/steam-mcp](https://github.com/algorhythmic/steam-mcp)
- [steamwebapi.com MCP](https://api.steamwebapi.com/mcp)
