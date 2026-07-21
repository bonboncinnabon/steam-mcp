## Context

The repository is currently a greenfield project with an approved product design
but no production implementation. Claude’s handover archive demonstrates a small
OpenAPI-driven prototype; it is retained only as endpoint research because it
lacks the required contracts, testing depth, identity model, remote
authorization, and operational boundaries.

The server must serve two delivery modes from one behaviorally identical core:

- A hosted Streamable HTTP endpoint that ordinary users authorize through OAuth
  without providing a Steam API key.
- A local or self-hosted `stdio` process that reads `STEAM_API_KEY` and optional
  `STEAM_USER` values from its environment.

The hosted service must respect Steam privacy controls and API terms, operate
within a shared daily API budget, isolate authenticated accounts, and remain
useful when undocumented Steam-operated endpoints change. Codex, Claude, OpenAI
remote MCP clients, and MCP Inspector are target compatibility surfaces.

## Goals / Non-Goals

**Goals:**

- Provide eight stable, read-only, task-oriented Steam tools over both supported
  transports.
- Keep domain behavior independent of MCP, HTTP, OAuth, and infrastructure
  implementations.
- Implement MCP OAuth 2.1 resource-server behavior with audience-bound access
  tokens and no token passthrough.
- Resolve explicit Steam identities remotely and optional `STEAM_USER` defaults
  locally without storing account links.
- Isolate documented and best-effort Steam sources behind typed adapters with
  predictable degradation.
- Return bounded, versioned, structured results and actionable stable errors.
- Protect upstream capacity through global and per-user quotas, concurrency
  limits, bounded fan-out, and backpressure.
- Avoid hosted account persistence and exclude secrets and Steam payloads from
  logs, fixtures, errors, and quota keys.
- Develop every behavior with strict one-test-at-a-time Red-Green-Refactor and
  fresh verification evidence.
- Keep code small, cohesive, explicit, and documented at public and non-obvious
  boundaries.

**Non-Goals:**

- Trading, purchasing, posting, messaging, account mutation, game launching, or
  Steamworks publisher operations.
- Game-night planning or player-comparison tools.
- Remote storage of user-supplied Steam API keys.
- Access to private Steam data or circumvention of Steam privacy controls.
- A generic Steam API proxy, an automatically generated tool catalog, or
  scraping non-Steam sites.
- Persisting libraries, friends, achievements, activity, wishlists, prompts, or
  tool inputs by default.
- Building an OAuth authorization server inside this repository.
- Steam identity linking, MCP-managed accounts, and account mutation or deletion
  workflows.
- Caching or request coalescing before observed traffic demonstrates a need.

## Decisions

### 1. Use TypeScript with the stable MCP TypeScript SDK

The implementation will target supported Node.js LTS releases, strict
TypeScript, the stable production MCP TypeScript SDK line, and runtime schemas
compatible with the SDK. Dependency versions will be locked and refreshed only
with verified compatibility.

**Rationale:** TypeScript provides one type system across MCP schemas, domain
contracts, HTTP adapters, and both transports. The official SDK provides direct
protocol compatibility and current reference implementations.

**Alternatives considered:**

- Python with FastMCP offers quick scaffolding but would not improve the core
  product and makes the approved TypeScript direction harder to preserve.
- Importing the prototype would accelerate initial output but retain its
  generated-tool architecture and missing quality boundaries.

### 2. Keep a transport-independent application core

Dependencies point inward:

```text
HTTP transport ----|
stdio transport ---|--> MCP tool adapters --> application services --> domain
OAuth adapter -----|                              |                  ^
                                                   v                  |
                                            declared ports -----------|
                                                   |
                                                   v
                               Steam, quota, authorization, and telemetry adapters
```

The core modules are:

- `domain`: identifiers, normalized entities, source tiers, versioned results,
  errors, and pure rules.
- `application`: use cases, composite Steam-data composition, and declared
  ports.
- `steam`: documented and best-effort upstream adapters plus shared HTTP policy.
- `mcp`: tool definitions, schemas, annotations, text rendering, and service
  invocation.
- `identity`: explicit and local-default identity resolution.
- `transports`: independent `stdio` and Streamable HTTP entry points.
- `infrastructure`: configuration, quota, authorization, and observability
  adapters.

**Rationale:** Domain and application behavior can be tested without framework
or network dependencies, and both transports cannot drift into different product
behavior.

**Alternatives considered:** A single server module is initially shorter but
creates the same monolithic testing and maintenance problems seen in several
existing Steam MCP implementations.

### 3. Expose eight curated tools rather than raw Steam operations

The public surface is:

- `steam_get_player`
- `steam_get_library`
- `steam_get_recent_activity`
- `steam_get_achievements`
- `steam_get_friends`
- `steam_get_wishlist`
- `steam_search_games`
- `steam_get_game`

All tools are read-only, reject unknown input fields, use bounded collections,
and declare precise annotations and input/output schemas. Composite tools call
application services rather than recursively calling MCP tools.

**Rationale:** This surface covers the approved workflows while keeping model
routing and context cost manageable. It differentiates the product through
coherent tasks rather than endpoint count.

**Alternatives considered:** Dozens of one-endpoint tools create context noise;
action-dispatch mega-tools reduce schema clarity; an arbitrary API caller
weakens security and contract stability.

### 4. Use a common versioned result contract

Successful structured content uses:

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

Expected failures set MCP `isError: true` and use:

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

Stable v1 codes are `INVALID_INPUT`, `IDENTITY_NOT_LINKED`, `PROFILE_PRIVATE`,
`NOT_FOUND`, `STEAM_AUTH_FAILED`, `STEAM_RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`,
`BEST_EFFORT_SOURCE_CHANGED`, `USER_QUOTA_EXCEEDED`, and `INTERNAL_ERROR`.

Text content is concise and derived from the structured result. Structured
content, not prose, is the compatibility contract.

**Rationale:** Models receive actionable errors and deterministic fields while
humans retain readable output. Optional facet failures can be represented
without losing successful data.

### 5. Separate MCP authorization, application identity, and Steam credentials

The hosted endpoint is an OAuth 2.1 resource server. An external OAuth/OIDC
authorization server supplies authorization, discovery, PKCE,
client-registration compatibility, token issuance, and revocation. The MCP
service validates signature, issuer, audience, expiry, scope, and token status.

Subject-oriented tools resolve identity in this order:

1. Explicit tool input.
2. Local `STEAM_USER` in local mode only.
3. `IDENTITY_NOT_LINKED`.

Hosted Steam calls use a service-owned API key from the deployment secret
manager. Local calls use `STEAM_API_KEY`. Neither MCP tokens nor Steam
credentials cross those boundaries.

**Rationale:** MCP OAuth controls access to this service, while the Steam API
key authenticates the application. Public Steam references are tool inputs, not
account identity. Keeping those mechanisms separate avoids account storage,
confused-deputy behavior, and unnecessary lifecycle endpoints.

**Alternatives considered:** A custom authorization server is unnecessary
security-sensitive scope; Steam OpenID linking creates an unrelated account
product; remote bring-your-own-key creates a credential vault; placing Steam
keys in tool arguments risks model and trace exposure.

### 6. Classify every upstream operation by stability

Each adapter declares one source tier:

- `supported`: documented Steam Web API behavior.
- `best_effort`: undocumented public behavior on an allowlisted Steam-operated
  host.
- `derived`: a deterministic service result computed from upstream facts.

Best-effort adapters are separate from documented adapters, use conservative
rates, and return `BEST_EFFORT_SOURCE_CHANGED` when validation detects drift. V1
adds no response cache or request coalescer until measurements justify one.
`steam_get_game` and other composite results retain successful facets and mark
`meta.partial` when selected optional best-effort sources fail. Failures from
selected supported Steam Web API facets remain terminal.

`steam_get_game` always uses store details as its required app-identity anchor
and compact default result. Its selectable optional facet enum is `reviews`,
`current_players`, `deck_compatibility`, `news`, and `global_achievements`. Only
selected optional facets are fetched. `global_achievements` composes both the
supported achievement-definition schema and global unlock percentages.

Outbound requests use HTTPS and an explicit Steam host allowlist. Redirect
targets are revalidated on every hop. Model-controlled values cannot choose
hosts, methods, credentials, or arbitrary headers.

**Rationale:** Wishlist enrichment, search, store details, Deck information, and
the zero-content aggregate-review invocation require useful but incompletely
documented Steam behavior. Steam documents the review summary fields but not the
`num_per_page=0` data-minimizing request. Isolation preserves usefulness without
pretending these compatibility assumptions are stable.

**Alternatives considered:** Excluding all undocumented endpoints makes the
product materially weaker; mixing them into one generic client hides their risk
and makes drift harder to diagnose.

### 7. Enforce policy before issuing upstream work

The hosted request path is:

```text
authenticate -> validate tool input -> reserve user/global quota
-> acquire host/operation concurrency slot
-> call typed adapter -> validate/normalize
-> produce structured result -> emit redacted telemetry
```

Central typed policy objects define timeouts, retry attempts, page and output
limits, concurrency, global reserve, and user quotas. Invalid configuration
fails startup.

The initial single-instance deployment uses bounded process-local atomic quota
accounting keyed by an opaque digest of the non-logged OAuth subject. A process
restart resets those counters and can replenish that day's allowance. A
distributed atomic quota adapter is therefore required before horizontal
scaling, broad public rollout, or restart-safe enforcement. Neither mode stores
account or Steam payload state.

**Rationale:** Reserving quota before work protects Valve limits immediately.
Keeping the port storage-independent avoids premature infrastructure, while the
distributed-backend scale gate prevents horizontally scaled instances from
overspending. Centralized values avoid behavior drifting across tools.

**Alternatives considered:** Treating in-process counters as multi-instance safe
would be incorrect; requiring Redis before the first hosted instance adds
unnecessary operations; unbounded retry and fan-out risks consuming the shared
daily budget.

### 8. Make the hosted transport stateless and standards-compliant

The service exposes one Streamable HTTP MCP endpoint plus separate liveness and
readiness endpoints. The MCP path requires HTTPS in deployed environments,
validates Origin and Host, and binds tokens to the canonical resource URI.
Health checks do not call Steam.

Application behavior is stateless. Shutdown stops accepting traffic, drains
active work within a deadline, cancels remaining upstream requests, and closes
the transport plus any configured quota client.

**Rationale:** Stateless instances support horizontal scaling, staged rollout,
and fast rollback without session affinity.

**Alternatives considered:** Stateful MCP sessions complicate routing and
resumability without benefiting these bounded read operations. Legacy HTTP+SSE
is not added to a new implementation.

### 9. Keep local behavior equivalent but credential acquisition different

The `stdio` entry point constructs the same services and tool registry using
environment configuration and no persistence infrastructure. Process-local
adapters are added only when a tool behavior actually consumes their ports. It
writes only MCP protocol messages to stdout and sends redacted diagnostics to
stderr. Missing key or identity configuration becomes an actionable tool or
startup error according to whether the enabled tools require it.

**Rationale:** Local users receive the same contracts and tests without hosted
identity persistence or hosted quota service. Environment-based credentials
follow MCP guidance for `stdio` servers.

**Alternatives considered:** A separate local implementation would duplicate
behavior and inevitably diverge.

### 10. Treat privacy and observability as explicit ports

The MCP server does not create accounts or durably store OAuth subjects, Steam
identities, Steam payloads, prompts, tool arguments, credentials, or raw
upstream bodies. Quota adapters store only opaque subject-derived keys and
bounded counters for their configured rollover window. Redacted operational
events follow the deployment platform's retention policy.

Metrics use bounded labels such as tool name, result code, source tier, and
status class. Raw or hashed user identifiers are not log or metric labels. User
account lifecycle, including deletion, belongs to the external authorization
provider and is not exposed through MCP.

**Rationale:** Avoiding sensitive collection is safer than attempting to secure
unnecessary data, while bounded telemetry still supports reliability and abuse
response.

### 11. Use strict TDD and layered verification as release gates

Each behavior follows one-test-at-a-time Red-Green-Refactor. The red failure and
green pass must both be observed before proceeding. Bug fixes start with a
failing regression test.

The test architecture includes:

- Pure domain unit tests.
- Tool schema and result contract tests.
- Scrubbed upstream adapter fixtures for success, privacy, malformed data,
  timeouts, redirects, 429s, and 5xx responses.
- MCP conformance tests for both transports.
- OAuth and token-validation tests.
- Atomic quota, cancellation, and concurrency tests.
- Opt-in live Steam contract probes using a dedicated test key.
- Cross-client smoke tests and operational load, shutdown, rollout, and rollback
  tests.

CI requires strict type checking, linting, formatting, unit and contract tests,
dependency auditing, at least 90 percent overall line and branch coverage, and
100 percent branch coverage plus mutation or fault-injection tests for
authorization, identity separation, secret redaction, quota accounting, and host
enforcement.

**Rationale:** Coverage alone cannot prove failure, boundary, concurrency, or
security behavior. Layered tests make each risk observable at the narrowest
useful level.

## Risks / Trade-offs

- **[Shared Steam API key exhausts the daily quota]** → Reserve quota atomically
  before calls, keep a global safety margin, apply per-user budgets, alert
  early, and return `USER_QUOTA_EXCEEDED` or `STEAM_RATE_LIMITED` without
  uncontrolled retries.
- **[Undocumented Steam endpoints drift or disappear]** → Isolate and validate
  each best-effort adapter, run opt-in live probes, alert on drift, return
  `BEST_EFFORT_SOURCE_CHANGED`, and preserve successful composite facets.
- **[OAuth providers differ in MCP client-registration support]** → Select a
  provider only after testing discovery, PKCE, Resource Indicators, Client ID
  Metadata Documents or Dynamic Client Registration, and target clients in a
  staging deployment.
- **[OAuth subject is confused with Steam identity]** → Require explicit public
  Steam references remotely, never derive Steam identity from an OAuth subject,
  and never forward MCP tokens.
- **[A public endpoint attracts abuse]** → Require OAuth, enforce per-user and
  global quotas, use bounded input/output/fan-out, preserve redacted audit
  events, and begin with a limited rollout.
- **[Composite tools produce large results]** → Use opaque pagination, bounded
  defaults, explicit facet selection, output-size limits, and concise structured
  summaries.
- **[Strict TDD increases initial delivery time]** → Keep behavioral increments
  small and the domain framework-independent so Red-Green-Refactor cycles remain
  fast; the added time buys safer auth, quota, and compatibility changes.
- **[Cross-client behavior differs despite protocol compliance]** → Maintain a
  tested compatibility matrix and treat client smoke tests as release evidence
  rather than assuming SDK-level conformance is sufficient.
- **[Process-local quotas reset on restart and do not coordinate across
  instances]** → Keep initial deployment single-instance and cohort-limited;
  require a tested distributed atomic quota adapter before horizontal scaling,
  broad public rollout, or restart-safe enforcement.

## Migration Plan

This is a greenfield rollout, so delivery is staged capability rollout rather
than replacement of an existing service:

1. Establish the TypeScript project, test harness, domain contracts, common
   results, and configuration validation through TDD.
2. Implement the typed Steam HTTP boundary and documented adapters with scrubbed
   fixtures and opt-in live probes.
3. Implement the eight application services and MCP tool contracts over `stdio`;
   publish no hosted endpoint yet.
4. Add atomic single-instance quotas, bounded concurrency, and redacted
   observability.
5. Add OAuth resource-server validation, Streamable HTTP, health checks, and
   graceful shutdown without account or Steam-identity persistence.
6. Deploy to staging and verify MCP Inspector, Codex, Claude, and OpenAI remote
   MCP compatibility plus quota and rollback behavior.
7. Release local/self-hosted packaging, then open the hosted service to a
   quota-limited cohort.
8. Increase hosted access only after observed reliability, capacity, privacy,
   and upstream-budget evidence meets release gates.

Rollback restores the previous versioned container. A best-effort adapter can be
disabled independently without rolling back the entire MCP service.

## Open Questions

- Which external OAuth/OIDC provider and hosting platform best satisfy current
  MCP discovery and client-registration behavior, operational cost, regional
  requirements, and supported-client testing? This is a deployment selection,
  not a reason to change the resource-server contract.
- What initial hosted per-user quotas preserve a safe reserve under the observed
  Steam call mix? Defaults will be chosen from load and live-contract evidence
  before public rollout.
- Which Steam-operated best-effort endpoints remain sufficiently stable at
  implementation time for each optional facet? Each candidate must pass
  adapter-specific validation and live probing before inclusion.
