# Architecture

Steam MCP is a read-only, remote-first MCP server with an equivalent local
`stdio` mode. It exposes a curated Steam data surface rather than a generic
Steam API proxy. The implementation is stateless with respect to users and Steam
data.

## Scope

The public surface contains exactly eight tools:

- `steam_get_player`
- `steam_get_library`
- `steam_get_recent_activity`
- `steam_get_achievements`
- `steam_get_friends`
- `steam_get_wishlist`
- `steam_search_games`
- `steam_get_game`

Every tool is annotated read-only, non-destructive, idempotent, and open-world.
The server does not offer analysis, recommendations, game-night planning, player
comparison, trading, purchasing, messaging, account linking, or account
deletion. Account lifecycle belongs to the external OAuth provider and is not
reachable through MCP.

## Dependency direction

Dependencies point from delivery and infrastructure toward the application and
domain layers:

```text
hosted HTTP ----|
local stdio ----| -> MCP contracts and bindings -> application services -> domain
OAuth ----------|                                  |                    ^
                                                    v                    |
                                             application ports ----------|
                                                    ^
                                                    |
                          Steam, quota, concurrency, and telemetry adapters
```

The modules have these responsibilities:

- `src/domain`: validated identifiers, normalized Steam data, source tiers,
  stable result envelopes, and bounded service policy.
- `src/application`: one use-case service per tool, identity resolution,
  pagination, enrichment, and ports for external behavior.
- `src/identity`: parsing for SteamID64, vanity names, and constrained Steam
  Community profile URLs.
- `src/steam`: typed upstream adapters and the shared HTTPS, redirect, timeout,
  retry, and response-size policy.
- `src/mcp`: the eight strict schemas, tool annotations, registry, and safe
  conversion from application results to MCP responses.
- `src/transports`: local `stdio`, stateless Streamable HTTP, health routing,
  Node HTTP adaptation, OAuth metadata, and hosted shutdown lifecycle.
- `src/infrastructure`: configuration, OAuth validation, Host and Origin checks,
  local/hosted composition, process-local quotas and concurrency, and redacted
  observability.

The package exposes two portable Node entry points. `steam-mcp` composes local
stdio mode; `steam-mcp-hosted` parses hosted environment configuration, starts
the Node HTTP listener, and coordinates `SIGINT`/`SIGTERM` draining. Neither
entry point changes the application or domain dependency direction.

Application services depend on the `SteamDataPort`, not concrete HTTP clients.
Composite behavior is implemented in services and never by one MCP tool calling
another. The local and hosted transports therefore share the same tool contracts
and domain behavior.

## Request paths

### Hosted Streamable HTTP

The hosted MCP endpoint is stateless: each POST receives a fresh MCP server and
transport instance, and responses do not issue an MCP session ID. The request
path is:

```text
Host/Origin boundary -> canonical resource and method check -> OAuth gate
-> strict MCP input validation -> quota reservation -> concurrency admission
-> typed Steam adapter -> validated result -> redacted telemetry
```

The HTTP boundary validates the actual `Host` header against configured hosts.
It does not use `Forwarded` or `X-Forwarded-Host` to rescue an invalid host.
Browser requests that include `Origin` must match a configured HTTPS origin;
non-browser MCP clients may omit it. Deployed resource, issuer, and origin URLs
are HTTPS.

The service is an OAuth 2.1 resource server, not an authorization server. It
validates RS256 signatures, issuer, resource audience, time claims, required
scopes, subject, and current token status before constructing tool execution
context. Signing keys come from the configured HTTPS JWKS endpoint. Current
token status comes from the configured HTTPS introspection endpoint using a
confidential client ID and secret. Bearer tokens are stripped before a request
enters the MCP SDK and are never passed to Steam. The downstream context
contains only the OAuth subject and granted scopes. The external provider owns
login, consent, revocation, and account deletion; the MCP surface has no
account, Steam-link, unlink, revocation, or deletion lifecycle.

The Node listener is intentionally plain HTTP. A deployment terminates TLS at a
trusted reverse proxy and maps requests onto URLs based on the configured public
HTTPS resource origin. The proxy must preserve the original `Host`; forwarded
host headers do not override the allowlist. `ALLOWED_HOSTS` is mandatory, while
`ALLOWED_ORIGINS` is optional because non-browser MCP clients can omit `Origin`.

Active requests are tracked only so a stateless cancellation notification can
cancel matching work. The bounded registry key is an opaque SHA-256 digest of
the authorization header plus the typed JSON-RPC request ID. It does not retain
the raw token, body, or response, and entries are removed when requests settle.

`GET /livez` checks only that the process can serve. `GET /readyz` checks the
required authorization and configured quota dependencies and never calls Steam.
Shutdown marks readiness false, stops accepting traffic, drains active work to a
deadline, cancels remaining work, and closes HTTP and any configured quota
client.

### Local stdio

The local entry point builds the same services, contracts, and registry. It
reads `STEAM_API_KEY` and optional `STEAM_USER` from the process environment.
`STEAM_USER` is only a default public Steam reference; it is not an account
link. A tool's explicit `user` always wins. Protocol messages use stdout and
sanitized diagnostics use stderr.

The local runtime currently uses a fixed `US`/`english` storefront policy and
enables the implemented best-effort Steam sources. A missing Steam API key only
fails operations that require the documented Web API key; it is never placed in
a tool argument.

## Steam source tiers and degradation

Every successful result names one or more source tiers:

- `supported`: documented Steam Web API behavior.
- `best_effort`: narrowly allowlisted, Steam-operated behavior without a stable
  response contract.
- `derived`: deterministic service output derived from upstream facts.

Supported adapters cover vanity resolution, profiles, bans, owned and recent
games, achievements, friend lists, current-player counts, news, and global
achievement facts. Best-effort adapters cover wishlist data, store search, store
details, aggregate reviews, and Steam Deck compatibility. Approved but currently
unexposed tag adapters do not expand the eight-tool contract.

Best-effort sources are independently switchable at composition time and have
strict response validation. Contract drift becomes `BEST_EFFORT_SOURCE_CHANGED`,
not guessed data. `steam_get_game` anchors every success in required store
details. Failures in selected optional best-effort facets preserve successful
data, set `meta.partial`, add a warning, and list the facet in
`unavailableFacets`. Failures from selected supported facets remain terminal.
Recent activity, friend presence, and achievement metadata also degrade
explicitly where their services define a safe partial result.

No response cache or request coalescer is part of the current implementation.
Calls are bounded by the shared execution policy instead.

## Upstream safety and capacity

Outbound requests are generated from a closed endpoint table. Model-controlled
values can populate validated query parameters but cannot choose a host, method,
credential, arbitrary path, or header. Requests are HTTPS `GET` calls with JSON
acceptance to these hosts only:

- `api.steampowered.com`
- `store.steampowered.com`
- `steamcommunity.com`

Redirects are manual and revalidated on every hop. The HTTP client enforces an
overall deadline, a maximum response size, no more than five redirects, bounded
retries with jitter, cancellation, and sanitized errors. Parsed bodies are
validated and normalized before reaching application services.

The baseline policy uses an 8-second upstream timeout, at most two retry
attempts, a 30-second execution deadline, 256 KB output limit, default page size
20, maximum page size 100, maximum fan-out 20, host concurrency 8, operation
concurrency 4, and a queue of 64. Startup rejects invalid or unsafe policy
combinations.

Hosted quota reservation is designed to happen before upstream work. The
single-instance adapter tracks a bounded daily global total and per-subject
total, preserving a global safety reserve. Subject keys are SHA-256 digests and
are not logged. Counters reset at UTC-day rollover and process restart. A
distributed atomic quota implementation is required before horizontal scaling,
broad public rollout, or restart-safe enforcement.

## Data retention and observability

The MCP server does not durably store OAuth subjects, Steam identities, Steam
payloads, prompts, tool arguments, access tokens, Steam credentials, or raw
upstream bodies. Process-local state is limited to bounded quota counters,
concurrency queues, and live cancellation entries. A restart discards it.

Operational events and metrics use allowlisted, bounded fields such as tool
name, stable result code, source tier, status class, dependency category, and
duration. User identifiers, even hashed identifiers, are not labels. The
redaction boundary removes configured secrets, bearer values, Steam-key-shaped
values, URLs, sensitive object keys, control characters, oversized strings, deep
structures, and large collections before emission. Deployment-platform retention
applies only to those redacted records.

## Threat boundaries

- **OAuth is MCP authorization, not Steam identity.** The OAuth subject limits
  service access and quota accounting. The explicit `user` input identifies
  public Steam data; no durable association is created.
- **Steam API credentials authenticate the application.** Hosted deployments use
  an operator-owned secret; local deployments use `STEAM_API_KEY`. Tokens and
  Steam keys never cross those roles.
- **Public means Steam-public.** Private libraries, recent activity,
  achievements, friend lists, and wishlists return `PROFILE_PRIVATE`; the server
  does not attempt to bypass Steam privacy controls.
- **Best-effort remains Steam-only.** Undocumented behavior is isolated to
  approved Steam-operated endpoints. There is no arbitrary URL fetcher,
  third-party scraping, or generic API passthrough.
- **Bounded work precedes convenience.** Input limits, cursor context checks,
  quota reservation, concurrency admission, fan-out caps, response limits, and
  cancellation constrain abuse and accidental amplification.
- **Expected failures are stable and sanitized.** Internal exceptions, raw
  responses, URLs, credentials, and caller-controlled abort reasons do not
  become public error messages.

For exact source requests and compatibility risks, see
[`upstream-sources.md`](./upstream-sources.md). For the public schemas, see
[`tool-reference.md`](./tool-reference.md).
