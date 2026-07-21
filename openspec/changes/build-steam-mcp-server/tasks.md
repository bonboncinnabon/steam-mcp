## 1. Project Foundation and Quality Gates

- [x] 1.1 Initialize the strict TypeScript workspace for supported Node.js LTS
      releases with separate source, test, fixture, migration, and
      executable-package boundaries.
- [x] 1.2 Add locked production and development dependencies for the stable MCP
      TypeScript SDK, runtime schemas, testing, linting, formatting, coverage,
      mutation testing, and dependency auditing.
- [x] 1.3 Configure strict type checking, linting, formatting, deterministic
      tests, and CI coverage thresholds of at least 90 percent for both lines
      and branches.
- [x] 1.4 Add documented Red-Green-Refactor commands and a test-evidence
      convention that records the intended focused failure before each
      production behavior is implemented.
- [x] 1.5 Add CI jobs for type checking, linting, formatting, unit tests,
      contract tests, dependency auditing, coverage, and targeted high-risk
      mutation or fault-injection suites.

## 2. Domain Contracts and Configuration

- [x] 2.1 TDD the SteamID64, app ID, ISO timestamp, currency, pagination-cursor,
      and bounded-collection value objects, including malformed and boundary
      inputs.
- [x] 2.2 TDD the versioned success and error envelopes, stable v1 error
      taxonomy, partial-result warnings, source tiers, and structured-to-text
      rendering contract.
- [x] 2.3 TDD centralized typed policies for timeouts, retries, quotas, safety
      reserve, cache duration, concurrency, fan-out, pagination, execution
      deadlines, and output size.
- [x] 2.4 TDD hosted and local configuration parsing, secret-safe diagnostics,
      required values, numeric bounds, incompatible combinations, and deployment
      HTTPS requirements.
- [x] 2.5 Define the inward-facing application ports for Steam data, identity,
      authorization context, quota, cache, coalescing, persistence, clock,
      cancellation, and observability.

## 3. Shared Steam HTTP Boundary

- [x] 3.1 TDD allowlisted HTTPS request construction so model-controlled input
      cannot select hosts, methods, credentials, or arbitrary headers.
- [x] 3.2 TDD redirect-hop revalidation, credential-safe URL handling,
      response-size limits, deadlines, cancellation, and sanitized network
      failures.
- [x] 3.3 TDD bounded retry classification for transient network failures, HTTP
      429, selected 5xx responses, jittered backoff, retry guidance, and
      non-retryable authentication failures.
- [x] 3.4 TDD upstream response validation and normalization so malformed
      supported responses fail safely and raw bodies never cross public or
      telemetry boundaries.
- [x] 3.5 Add scrubbed HTTP fixtures and contract tests covering success,
      privacy restrictions, empty data, malformed data, redirects, timeouts,
      cancellation, 429, 5xx, and credential rejection.

## 4. Steam Identity and Supported Adapters

- [x] 4.1 TDD parsing and validation for SteamID64, vanity names, and
      allowlisted Steam Community profile URLs without numeric precision loss or
      arbitrary URL fetching.
- [x] 4.2 TDD the typed vanity-resolution adapter and deterministic `NOT_FOUND`,
      `STEAM_AUTH_FAILED`, rate-limit, and unavailable mappings.
- [x] 4.3 TDD supported player-summary, ban-summary, presence, and current-game
      adapters with privacy-aware normalization.
- [x] 4.4 TDD supported owned-games and recently-played adapters with
      empty-versus-private behavior and bounded response handling.
- [x] 4.5 TDD supported player-achievement, game-schema, and global-achievement
      adapters with stable achievement identifiers and optional rarity
      enrichment.
- [x] 4.6 TDD the supported friend-list adapter and bounded batched profile
      enrichment without unbounded fan-out.
- [x] 4.7 TDD supported current-player-count and news adapters used by
      consolidated game details.

## 5. Best-Effort and Derived Steam Sources

- [x] 5.1 Document and approve each initial Steam-operated best-effort endpoint,
      its host, expected contract, data classification, call cost, cache policy,
      and independent disable switch.
- [x] 5.2 TDD the best-effort wishlist adapter, including money normalization,
      pagination inputs, contract drift, raw-body exclusion, and
      `BEST_EFFORT_SOURCE_CHANGED`.
- [x] 5.3 TDD best-effort store-search and store-detail adapters with ambiguous
      matches, missing apps, localized money, genres, categories, and bounded
      candidate sets.
- [x] 5.4 TDD optional Steam Deck, aggregate review, approved tag, and other
      game-detail facet adapters so each can fail independently and be disabled
      without affecting supported facets.
- [x] 5.5 Add opt-in live contract probes using a dedicated test credential,
      automatic fixture-safety checks, and bounded drift metrics; keep the
      probes excluded from default CI.

## 6. Identity Resolution and Player Application Services

- [x] 6.1 TDD the common identity-resolution order of explicit user, hosted
      linked identity, local `STEAM_USER`, then `IDENTITY_NOT_LINKED`, including
      tenant-safe lookup and no link mutation.
- [x] 6.2 TDD `steam_get_player` for normalized public profile facets, unknown
      players, private fields, and stable envelope rendering.
- [x] 6.3 TDD `steam_get_library` for filtering, sorting, opaque cursor
      pagination, limits, deterministic continuation, empty libraries, and
      private libraries.
- [x] 6.4 Remove derived library analysis from the v1 MCP surface so player
      tools expose normalized Steam facts without opinionated heuristics.
- [x] 6.5 TDD `steam_get_recent_activity` for bounded recent games, current
      activity, successful empty results, privacy, and partial optional facets.
- [x] 6.6 TDD `steam_get_achievements` for user-and-game resolution, opaque
      pagination, unlock state and time, optional rarity, no-achievement games,
      and privacy.
- [x] 6.7 TDD `steam_get_friends` for bounded pagination, optional presence
      enrichment, fan-out limits, unavailable enrichment entries, and private
      lists.
- [x] 6.8 TDD `steam_get_wishlist` for bounded pagination, price and discount
      fields, source-tier metadata, unavailable apps, privacy behavior, and
      best-effort drift.

## 7. Game Application Services

- [x] 7.1 TDD `steam_search_games` for blank-input rejection, ranked bounded
      candidates, exact identifiers, ambiguity evidence, and no silent
      single-result selection.
- [x] 7.2 TDD `steam_get_game` with required store details as the sole default,
      explicit optional-facet enums, fetch-only-selected optional behavior, and
      `NOT_FOUND` for an unresolved required app.
- [x] 7.3 TDD `steam_get_game` partial-result composition so successful
      supported facets survive optional best-effort failures with precise
      warnings and source tiers.
- [x] 7.4 Remove recommendation behavior and candidate-discovery infrastructure
      from v1 so the MCP remains a focused Steam data-access layer.

## 8. MCP Tool Registry and Local Transport

- [x] 8.1 TDD strict input and output schemas for all eight tools, including
      unknown-field rejection, bounds, annotations, descriptions, and stable
      structured content.
- [ ] 8.2 TDD the shared MCP tool adapter that invokes application services,
      maps expected failures to `isError: true`, sanitizes unexpected
      exceptions, and derives concise text from structured results.
- [ ] 8.3 TDD the single shared tool registry and verify exact tool-name,
      schema, annotation, result, and error parity across transport
      constructions.
- [ ] 8.4 TDD the stdio entry point with environment credentials, memory
      infrastructure, clean initialization and shutdown, actionable missing-key
      behavior, and protocol-only stdout.
- [ ] 8.5 Add MCP SDK and Inspector conformance tests for local initialization,
      tool listing, representative executions, cancellation, structured errors,
      and stderr diagnostic isolation.

## 9. Hosted Persistence, Quotas, and Coordination

- [ ] 9.1 Define PostgreSQL schemas and backward-compatible migrations for
      authorization subjects, optional linked SteamID64, consent, revocation,
      deletion state, and minimal audit metadata.
- [ ] 9.2 TDD the PostgreSQL account and Steam-link repository against migration
      fixtures, including tenant scoping, replacement, unlinking, deletion, and
      previous-version schema compatibility.
- [ ] 9.3 TDD atomic Redis-compatible global and per-user quota reservation,
      daily rollover, configured call costs, safety reserve, races across
      instances, and dependency failures.
- [ ] 9.4 TDD per-host and per-operation concurrency acquisition, bounded
      queueing, cancellation, deadlines, release-on-error, and backpressure.
- [ ] 9.5 TDD cache eligibility so only explicitly classified non-sensitive
      public game/store data can be cached and secrets or user payloads cannot
      enter keys or values.
- [ ] 9.6 TDD tenant-independent request coalescing for eligible reads,
      including concurrent success, failure, cancellation, waiter cleanup, and
      no cross-tenant state sharing.
- [ ] 9.7 Add bounded local-memory implementations of quota, cache, coalescing,
      and identity-default ports and prove they require no hosted dependencies
      or disk persistence.

## 10. Hosted Authorization and Steam Linking

- [ ] 10.1 Record an ADR and compatibility evaluation for the external
      OAuth/OIDC provider against Protected Resource Metadata, PKCE, Resource
      Indicators, supported client-registration methods, revocation, and target
      MCP clients.
- [ ] 10.2 TDD Protected Resource Metadata and `WWW-Authenticate` responses with
      the canonical resource URI, authorization-server location, and supported
      scopes.
- [ ] 10.3 TDD access-token validation for signature, issuer, audience, expiry,
      scope, token status, key rotation, malformed tokens, and authorization
      dependency failures.
- [ ] 10.4 Add high-risk mutation or fault-injection tests proving rejected
      tokens perform no tool, quota, persistence, or Steam work and MCP tokens
      are never passed upstream.
- [ ] 10.5 TDD Steam OpenID link initiation and callback verification, including
      authenticated state binding, replay and CSRF rejection, claimed-ID
      extraction, account replacement, and safe redirects.
- [ ] 10.6 TDD authenticated unlink and account-deletion workflows, minimum
      retained evidence, idempotency, and denial of cross-account reads or
      mutations without existence disclosure.
- [ ] 10.7 Add 100 percent branch coverage and targeted mutation or
      fault-injection checks for authorization, identity isolation, link
      lifecycle, and credential separation.

## 11. Hosted Streamable HTTP and Operations

- [ ] 11.1 TDD the Streamable HTTP MCP endpoint for authenticated
      initialization, request handling, cancellation, stateless operation,
      canonical resource binding, and rejection of legacy HTTP plus SSE.
- [ ] 11.2 TDD configured Origin and Host enforcement before authorization or
      MCP parsing, including missing, malformed, proxy-forwarded, and disallowed
      values.
- [ ] 11.3 TDD liveness and readiness endpoints so neither calls Steam and
      readiness reflects required storage and authorization dependencies.
- [ ] 11.4 TDD graceful shutdown that marks readiness false, stops new work,
      drains to a deadline, cancels remaining upstream requests, and closes
      HTTP, PostgreSQL, and Redis clients.
- [ ] 11.5 TDD redacted structured events, bounded metrics, privacy-preserving
      account correlation, drift signals, and secret scrubbing across nested
      errors and credential-bearing URLs.
- [ ] 11.6 Add high-risk mutation or fault-injection tests with 100 percent
      branch coverage for host enforcement, redaction, quota accounting, and
      shutdown cleanup.

## 12. Packaging and Public Documentation

- [ ] 12.1 Produce a reproducible local package with a supported executable
      command, pinned runtime range, clean install verification, provenance,
      checksums, and release metadata.
- [ ] 12.2 Document local client setup for Codex, Claude, OpenAI-compatible
      clients, and MCP Inspector using `STEAM_API_KEY` and optional
      `STEAM_USER`, without example secrets.
- [ ] 12.3 Document hosted connection, OAuth discovery, Steam identity linking,
      arbitrary public-profile lookup, unlinking, deletion, quotas, privacy
      limits, and troubleshooting.
- [ ] 12.4 Document architecture, dependency direction, all eight tool
      contracts, schemas, pagination, errors, source tiers, best-effort
      degradation, security model, data retention, and threat boundaries.
- [ ] 12.5 Document strict TDD contribution rules, fixture scrubbing, live-probe
      safety, test commands, coverage gates, compatibility policy, versioning,
      changelog, operations, migration, rollout, and rollback.
- [ ] 12.6 Verify local, self-hosted, and hosted documentation from clean
      supported environments without undocumented maintainer steps.

## 13. Release Verification and Rollout

- [ ] 13.1 Run fresh full verification for formatting, linting, strict types,
      unit and contract tests, dependency audit, coverage thresholds, and all
      configured mutation or fault-injection gates.
- [ ] 13.2 Run PostgreSQL and Redis integration suites for concurrent quotas,
      cache and coalescing isolation, cancellation, migration compatibility,
      account deletion, and dependency recovery.
- [ ] 13.3 Run opt-in Steam live probes with the dedicated credential, review
      best-effort drift, measure observed call costs, and set documented initial
      quota and cache policies while preserving the safety reserve.
- [ ] 13.4 Verify MCP Inspector, Codex, Claude, and OpenAI remote-client
      initialization, OAuth discovery, authorization, tool listing,
      representative calls, structured results, errors, and cancellation in
      staging.
- [ ] 13.5 Execute bounded load, abuse, outage, graceful-shutdown,
      staged-deployment, previous-version rollback, and independent
      best-effort-adapter disablement tests.
- [ ] 13.6 Publish the release evidence and compatibility matrix, then open the
      hosted endpoint only to the approved quota-limited cohort; expand access
      only after reliability, privacy, capacity, and Steam-budget gates pass.
