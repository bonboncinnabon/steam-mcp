# Steam MCP v1 design

- **Status:** Approved, amended 2026-07-22
- **Primary delivery:** Local stdio server
- **Remote delivery:** Private self-hosted Streamable HTTP with one static
  bearer token
- **Scope:** Eight read-only tools over public Steam data

## 1. Product boundary

Steam MCP gives MCP clients a small, typed, read-only interface to public Steam
data. It is not a generic Steam API proxy, recommendation engine, social
product, or account-management service.

The project ships software for operators to run. It does not provide a hosted
provider, project-operated account, public shared endpoint, or multi-tenant
service. Remote v1 is intended for one operator and explicitly approved clients.

## 2. Delivery modes

### Local stdio

The MCP client launches `steam-mcp` as a child process. The operator supplies
`STEAM_API_KEY` and may supply `STEAM_USER` as a default public profile. No
network listener or MCP access credential is involved.

### Self-hosted Streamable HTTP

The operator runs `steam-mcp serve` behind TLS and supplies:

- a deployment-owned `STEAM_API_KEY`;
- an optional operator-wide `STEAM_USER` default;
- one high-entropy `MCP_ACCESS_TOKEN`;
- the canonical HTTPS `MCP_RESOURCE_URI`;
- allowed Host values and, when needed, browser origins; and
- optional bounded capacity and source-switch settings.

Every client sends `Authorization: Bearer <MCP_ACCESS_TOKEN>` on each MCP
request. Clients must support a fixed authorization header. There is no OAuth
discovery, login, signup, consent, refresh, account, or individual token
revocation flow.

The HTTP endpoint is stateless. Each POST creates a fresh MCP server and
transport instance and returns no MCP session ID. The Node listener is plain
HTTP; a trusted proxy terminates TLS and preserves the public `Host` header.

## 3. Tool contract

The public surface contains exactly these tools:

- `steam_get_player`
- `steam_get_library`
- `steam_get_recent_activity`
- `steam_get_achievements`
- `steam_get_friends`
- `steam_get_wishlist`
- `steam_search_games`
- `steam_get_game`

All tools are read-only, non-destructive, idempotent, and open-world. Inputs are
strict and bounded. Results use stable structured envelopes, explicit source
tiers, partial-result metadata, and stable error codes.

The service does not support trades, purchases, market actions, messaging,
posting, account changes, Steam identity linking, recommendations, player
comparison, or generic URL fetching.

## 4. Architecture

Dependencies point inward:

```text
self-hosted HTTP --|
local stdio -------| -> MCP contracts -> application services -> domain
static bearer -----|                         |                  ^
                                              v                  |
                                       application ports --------|
                                              ^
                                              |
                              Steam, quota, concurrency adapters
```

- `domain` owns validated values, normalized data, result envelopes, and policy.
- `application` owns one service per tool, pagination, enrichment, and ports.
- `identity` parses public Steam references.
- `steam` owns typed allowlisted upstream adapters and network policy.
- `mcp` owns schemas, annotations, registration, and safe result conversion.
- `transports` owns stdio, Streamable HTTP, health, and shutdown behavior.
- `infrastructure` owns composition, configuration, bearer validation, request
  boundaries, quota, and concurrency.

Application services depend on ports, not MCP transports or HTTP clients.
Composite tools coordinate adapters through services and never call other MCP
tools.

## 5. Authentication and Steam identity

The self-hosted HTTP server accepts only the exact configured static bearer
token. It compares digests in constant time, fails with a generic `401`, and
strips the header before the MCP SDK or Steam client sees the request.

The token authorizes access to the instance. It has no user subject and is not
mapped to a Steam identity. Subject-oriented tools resolve `user` in this order:

1. explicit tool input;
2. operator-configured `STEAM_USER` default;
3. `IDENTITY_NOT_LINKED` without an upstream request.

In HTTP mode the default is shared by every authorized client and never inferred
from the bearer credential; explicit tool input still wins. The user may be a
SteamID64, vanity name, or allowlisted Steam Community profile URL and may refer
to any public profile. Authentication does not reveal private Steam data.

## 6. HTTP request boundary

The remote request path is:

```text
Host/Origin check -> exact URL and POST check -> bearer gate
-> MCP validation -> instance quota -> concurrency admission
-> Steam adapter -> normalized result
```

The server validates the actual `Host` header and never lets `Forwarded` or
`X-Forwarded-Host` override the allowlist. Browser origins must exactly match an
allowed HTTPS origin; clients that omit `Origin` remain supported.

Only the exact canonical MCP URL accepts POST. `/livez` and `/readyz` are GET
health routes. The remote transport does not expose OAuth metadata or the
deprecated HTTP+SSE transport.

## 7. Steam source policy

Successful results identify their source tier:

- `supported`: documented Steam Web API behavior;
- `best_effort`: narrowly allowlisted Steam-operated behavior without a stable
  response contract; or
- `derived`: deterministic service output derived from upstream facts.

Supported adapters cover public player and game facts from documented Steam
interfaces. Best-effort adapters cover approved wishlist, store, reviews, and
Steam Deck sources. Each best-effort source has strict validation, a bounded
call cost, and an independent disable switch. Contract drift returns
`BEST_EFFORT_SOURCE_CHANGED` rather than guessed data.

Outbound requests come from a closed endpoint table. Caller-controlled values
can populate validated parameters but cannot choose a host, method, arbitrary
path, credential, or header. Redirects are revalidated on every hop. Deadlines,
retry limits, response-size limits, cancellation, and sanitized errors apply to
all upstream work.

## 8. Quota and concurrency

The self-hosted process reserves quota before upstream work. V1 uses one bounded
daily instance budget and preserves a global safety reserve. All clients share
the same counters; there is no per-token, per-client, or per-Steam-user quota.

Host, operation, queue, page, output, deadline, and composite fan-out limits
bound work. Counters and queues are process-local. UTC day rollover and process
restart reset counters. Run exactly one instance unless a future distributed
atomic adapter is designed and verified.

Static shared authentication and process-local quota are not suitable for a
public or multi-tenant rollout. That change would require a new identity, abuse,
quota, privacy, and operational design.

## 9. Privacy and retention

The server does not durably store Steam identities, libraries, friends,
achievements, activity, wishlists, API responses, prompts, tool inputs, Steam
keys, or MCP bearer tokens. Process-local state is limited to bounded quota,
concurrency, cancellation, and lifecycle bookkeeping.

Telemetry uses only allowlisted bounded fields such as tool name, stable result
code, source tier, status class, duration, dependency category, and rejection
reason. It excludes raw or hashed user identifiers, headers, bodies, prompts,
arguments, credentials, URLs, and upstream responses.

The service does not promise anonymity from Steam. Steam receives the public
Steam and app identifiers needed for the request through the operator's network
and Steam API credential.

## 10. Failure behavior

Expected failures use stable sanitized errors. Important boundaries include:

- invalid bearer headers fail before MCP parsing or Steam work;
- missing remote `user` input fails before Steam resolution;
- private profile data returns `PROFILE_PRIVATE` rather than an empty result;
- exhausted instance budget returns `SERVICE_QUOTA_EXCEEDED`;
- source drift returns `BEST_EFFORT_SOURCE_CHANGED` or an explicit partial
  warning where the facet is optional;
- timeouts, cancellation, oversized responses, redirect violations, and queue
  saturation release reserved capacity; and
- internal exceptions never expose credentials, URLs, raw bodies, or caller
  input.

## 11. Verification

Every behavior change follows a focused red-green-refactor cycle. Required
coverage includes:

- tool schema and result contracts;
- static bearer success, missing/malformed/incorrect credentials, and proof the
  header is not passed to Steam;
- explicit remote Steam identity and absence of token-to-Steam mapping;
- Host and Origin enforcement;
- instance-wide quota, safety reserve, rollback, day rollover, and concurrency;
- Steam privacy, retry, redirect, response bounds, and source drift;
- secret redaction and durable-state exclusions;
- stateless Streamable HTTP, health, cancellation, drain, and shutdown; and
- exact target-client compatibility with a fixed authorization header.

OAuth-only client support is not a v1 acceptance criterion. Standards alignment
does not replace a live compatibility check against the exact client version.

## 12. Release and operations

The public `@abiswas97/steam-mcp` package must include the single `steam-mcp`
executable, user documentation, source register, license, and verified package
contents. Release evidence includes frozen dependency installation, format,
lint, type checks, tests, coverage, configured mutation checks, audit, build,
artifact provenance, and opt-in live Steam probes with dedicated credentials.

Remote deployment remains private and operator-controlled. Before exposure,
verify TLS, fixed-header client support, invalid-token rejection, Host/Origin
policy, all tools, quota behavior, sanitized diagnostics, graceful shutdown, and
rollback. Credential rotation updates the server and every approved client and
must prove the old token is rejected without printing either secret.

## 13. Decisions and references

- [ADR 0002: Static bearer authentication](../../adr/0002-static-bearer-authentication.md)
- [Self-hosted HTTP setup](../../hosted-setup.md)
- [Operations](../../operations.md)
- [Tool reference](../../tool-reference.md)
- [Steam upstream source register](../../upstream-sources.md)
