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

- Provide ten stable, read-only, task-oriented Steam tools over both supported
  transports.
- Keep domain behavior independent of MCP, HTTP, OAuth, and persistence
  implementations.
- Implement MCP OAuth 2.1 resource-server behavior with audience-bound access
  tokens and no token passthrough.
- Resolve explicit Steam identities and optional account-linked defaults without
  cross-tenant leakage.
- Isolate documented and best-effort Steam sources behind typed adapters with
  predictable degradation.
- Return bounded, versioned, structured results and actionable stable errors.
- Protect upstream capacity through global and per-user quotas, concurrency
  limits, caching, coalescing, and backpressure.
- Minimize persisted personal data and exclude secrets and Steam payloads from
  logs, fixtures, errors, and caches.
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
                               Steam, identity, quota, cache, and storage adapters
```

The core modules are:

- `domain`: identifiers, normalized entities, source tiers, versioned results,
  errors, and pure rules.
- `application`: use cases, composite analysis, recommendation rules, and
  declared ports.
- `steam`: documented and best-effort upstream adapters plus shared HTTP policy.
- `mcp`: tool definitions, schemas, annotations, text rendering, and service
  invocation.
- `identity`: explicit, hosted-linked, and local-default identity resolution.
- `transports`: independent `stdio` and Streamable HTTP entry points.
- `infrastructure`: PostgreSQL, Redis-compatible, configuration, authorization,
  and observability adapters.

**Rationale:** Domain and application behavior can be tested without framework
or network dependencies, and both transports cannot drift into different product
behavior.

**Alternatives considered:** A single server module is initially shorter but
creates the same monolithic testing and maintenance problems seen in several
existing Steam MCP implementations.

### 3. Expose ten curated tools rather than raw Steam operations

The public surface is:

- `steam_get_player`
- `steam_get_library`
- `steam_analyze_library`
- `steam_get_recent_activity`
- `steam_get_achievements`
- `steam_get_friends`
- `steam_get_wishlist`
- `steam_search_games`
- `steam_get_game`
- `steam_recommend_games`

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

Steam OpenID optionally links one SteamID64 to an authenticated account.
Subject-oriented tools resolve identity in this order:

1. Explicit tool input.
2. Authenticated account’s linked SteamID64.
3. Local `STEAM_USER`.
4. `IDENTITY_NOT_LINKED`.

Hosted Steam calls use a service-owned API key from the deployment secret
manager. Local calls use `STEAM_API_KEY`. Neither MCP tokens nor Steam
credentials cross those boundaries.

**Rationale:** MCP OAuth controls access to this service, Steam OpenID proves a
public Steam identity, and the Steam API key authenticates the application.
Conflating these mechanisms would create confused-deputy and secret-handling
risks.

**Alternatives considered:** A custom authorization server is unnecessary
security-sensitive scope; remote bring-your-own-key creates a credential vault;
placing Steam keys in tool arguments risks model and trace exposure.

### 6. Classify every upstream operation by stability

Each adapter declares one source tier:

- `supported`: documented Steam Web API behavior.
- `best_effort`: undocumented public behavior on an allowlisted Steam-operated
  host.
- `derived`: a deterministic service result computed from upstream facts.

Best-effort adapters are separate from documented adapters, use conservative
rates and short caches, and return `BEST_EFFORT_SOURCE_CHANGED` when validation
detects drift. `steam_get_game` and other composite results retain successful
facets and mark `meta.partial` when optional sources fail.

Outbound requests use HTTPS and an explicit Steam host allowlist. Redirect
targets are revalidated on every hop. Model-controlled values cannot choose
hosts, methods, credentials, or arbitrary headers.

**Rationale:** Wishlist enrichment, search, store details, and Deck information
require useful but incompletely documented Steam endpoints. Aggregate reviews
use Steam's documented store-review API. Isolation preserves usefulness without
pretending the remaining best-effort sources are stable.

**Alternatives considered:** Excluding all undocumented endpoints makes the
product materially weaker; mixing them into one generic client hides their risk
and makes drift harder to diagnose.

### 7. Enforce policy before issuing upstream work

The hosted request path is:

```text
authenticate -> resolve tenant -> validate tool input -> reserve user/global quota
-> consult cache/coalescer -> acquire host/operation concurrency slot
-> call typed adapter -> validate/normalize -> cache eligible public data
-> produce structured result -> emit redacted telemetry
```

Central typed policy objects define timeouts, retry attempts, page and output
limits, cache durations, concurrency, global reserve, and user quotas. Invalid
configuration fails startup.

PostgreSQL stores account identity, linked SteamID64, consent/revocation state,
and durable audit metadata. Redis-compatible storage provides atomic quota
accounting, short-lived public-data caching, and request coordination. Local
mode uses bounded memory adapters and stores no account state.

**Rationale:** Reserving quota before work and using atomic shared counters
prevents horizontally scaled instances from exceeding Valve limits. Centralized
values avoid behavior drifting across tools.

**Alternatives considered:** In-process counters cannot coordinate multiple
instances; database-only caching adds avoidable contention; unbounded retry and
fan-out risks consuming the shared daily budget.

### 8. Make the hosted transport stateless and standards-compliant

The service exposes one Streamable HTTP MCP endpoint plus separate liveness and
readiness endpoints. The MCP path requires HTTPS in deployed environments,
validates Origin and Host, and binds tokens to the canonical resource URI.
Health checks do not call Steam.

Application behavior is stateless; durable state is accessed through PostgreSQL
and Redis-compatible ports. Shutdown stops accepting traffic, drains active work
within a deadline, cancels remaining upstream requests, and closes transports
and storage clients.

**Rationale:** Stateless instances support horizontal scaling, staged rollout,
and fast rollback without session affinity.

**Alternatives considered:** Stateful MCP sessions complicate routing and
resumability without benefiting these bounded read operations. Legacy HTTP+SSE
is not added to a new implementation.

### 9. Keep local behavior equivalent but credential acquisition different

The `stdio` entry point constructs the same services and tool registry using
environment configuration and memory infrastructure. It writes only MCP protocol
messages to stdout and sends redacted diagnostics to stderr. Missing key or
identity configuration becomes an actionable tool or startup error according to
whether the enabled tools require it.

**Rationale:** Local users receive the same contracts and tests without hosted
identity, PostgreSQL, or Redis. Environment-based credentials follow MCP
guidance for `stdio` servers.

**Alternatives considered:** A separate local implementation would duplicate
behavior and inevitably diverge.

### 10. Treat privacy and observability as explicit ports

Hosted persistence is limited to authorization subject, optional linked
SteamID64, consent/revocation state, quota counters, non-sensitive short-lived
caches, and redacted operational events. Steam payloads, prompts, tool
arguments, credentials, and raw upstream bodies are not logged or durably stored
by default.

Metrics use bounded labels such as tool name, result code, source tier, and
status class. Account references in logs are privacy-preserving stable hashes
when correlation is required. Account unlink and deletion remove stored linkage
and account metadata according to the published retention policy.

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
- OAuth, token-validation, and tenant-isolation tests.
- Atomic quota, cache, coalescing, cancellation, and concurrency tests.
- Opt-in live Steam contract probes using a dedicated test key.
- Cross-client smoke tests and operational load, shutdown, rollout, and rollback
  tests.

CI requires strict type checking, linting, formatting, unit and contract tests,
dependency auditing, at least 90 percent overall line and branch coverage, and
100 percent branch coverage plus mutation or fault-injection tests for
authorization, identity isolation, secret redaction, quota accounting, and host
enforcement.

**Rationale:** Coverage alone cannot prove failure, boundary, concurrency, or
security behavior. Layered tests make each risk observable at the narrowest
useful level.

## Risks / Trade-offs

- **[Shared Steam API key exhausts the daily quota]** → Reserve quota atomically
  before calls, keep a global safety margin, apply per-user budgets, cache safe
  public data, coalesce identical requests, alert early, and return
  `USER_QUOTA_EXCEEDED` or `STEAM_RATE_LIMITED` without uncontrolled retries.
- **[Undocumented Steam endpoints drift or disappear]** → Isolate and validate
  each best-effort adapter, run opt-in live probes, alert on drift, return
  `BEST_EFFORT_SOURCE_CHANGED`, and preserve successful composite facets.
- **[OAuth providers differ in MCP client-registration support]** → Select a
  provider only after testing discovery, PKCE, Resource Indicators, Client ID
  Metadata Documents or Dynamic Client Registration, and target clients in a
  staging deployment.
- **[Steam OpenID is confused with delegated Steam authorization]** → Document
  the boundary, store only the verified SteamID64 link, and never forward MCP
  tokens or claim access beyond public Steam data.
- **[A public endpoint attracts abuse]** → Require OAuth, enforce per-user and
  global quotas, use bounded input/output/fan-out, preserve redacted audit
  events, and begin with a limited rollout.
- **[Caching exposes personal data]** → Cache only explicitly classified
  non-sensitive public game/store data by default; reject secrets from cache
  keys and prohibit durable caching of user payloads.
- **[Ten composite tools still produce large results]** → Use opaque pagination,
  bounded defaults, explicit facet selection, output-size limits, and concise
  structured summaries.
- **[Strict TDD increases initial delivery time]** → Keep behavioral increments
  small and the domain framework-independent so Red-Green-Refactor cycles remain
  fast; the added time buys safer auth, quota, and compatibility changes.
- **[Cross-client behavior differs despite protocol compliance]** → Maintain a
  tested compatibility matrix and treat client smoke tests as release evidence
  rather than assuming SDK-level conformance is sufficient.
- **[Hosted PostgreSQL and Redis increase operational scope]** → Hide them
  behind narrow ports, use managed services in production, keep local adapters
  memory-only, and stage hosted rollout after core behavior is complete.

## Migration Plan

This is a greenfield rollout, so migration is staged capability delivery rather
than replacement of an existing service:

1. Establish the TypeScript project, test harness, domain contracts, common
   results, and configuration validation through TDD.
2. Implement the typed Steam HTTP boundary and documented adapters with scrubbed
   fixtures and opt-in live probes.
3. Implement the ten application services and MCP tool contracts over `stdio`;
   publish no hosted endpoint yet.
4. Add PostgreSQL and Redis-compatible ports, migrations, atomic quotas,
   cache/coalescing, and redacted observability.
5. Add OAuth resource-server validation, Steam OpenID linking, tenant isolation,
   Streamable HTTP, health checks, and graceful shutdown.
6. Deploy to staging and verify MCP Inspector, Codex, Claude, and OpenAI remote
   MCP compatibility plus quota and rollback behavior.
7. Release local/self-hosted packaging, then open the hosted service to a
   quota-limited cohort.
8. Increase hosted access only after observed reliability, capacity, privacy,
   and upstream-budget evidence meets release gates.

Every database change is backward compatible for at least one deployed
application version. Rollback restores the previous versioned container while
retaining compatible schema changes. A best-effort adapter can be disabled
independently without rolling back the entire MCP service.

## Open Questions

- Which external OAuth/OIDC provider and hosting platform best satisfy current
  MCP discovery and client-registration behavior, operational cost, regional
  requirements, and supported-client testing? This is a deployment selection,
  not a reason to change the resource-server contract.
- What initial hosted per-user quotas and cache durations preserve a safe
  reserve under the observed Steam call mix? Defaults will be chosen from load
  and live-contract evidence before public rollout.
- Which Steam-operated best-effort endpoints remain sufficiently stable at
  implementation time for each optional facet? Each candidate must pass
  adapter-specific validation and live probing before inclusion.
