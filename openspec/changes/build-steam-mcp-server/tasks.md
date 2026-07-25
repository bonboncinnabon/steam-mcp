## 1. Project Foundation and Quality Gates

- [x] 1.1 Initialize the strict TypeScript workspace for supported Node.js LTS
      releases with separate source, test, fixture, and executable-package
      boundaries.
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
      reserve, concurrency, fan-out, pagination, execution deadlines, and output
      size.
- [x] 2.4 TDD remote and local configuration parsing, secret-safe diagnostics,
      required values, numeric bounds, incompatible combinations, and deployment
      HTTPS requirements, including a high-entropy `MCP_ACCESS_TOKEN` for remote
      mode and no OAuth configuration.
- [x] 2.5 Define the inward-facing application ports for Steam data, identity,
      instance quota, concurrency, clock, cancellation, and observability.

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
      its host, expected contract, data classification, call cost, and
      independent disable switch.
- [x] 5.2 TDD the best-effort wishlist adapter, including money normalization,
      pagination inputs, contract drift, raw-body exclusion, and
      `BEST_EFFORT_SOURCE_CHANGED`.
- [x] 5.3 TDD best-effort store-search and store-detail adapters with ambiguous
      matches, missing apps, localized money, genres, categories, and bounded
      candidate sets.
- [x] 5.4 TDD optional Steam Deck, aggregate review, and other game-detail facet
      adapters so each can fail independently and be disabled without affecting
      supported facets.
- [x] 5.5 Add opt-in live contract probes using a dedicated test credential,
      automatic fixture-safety checks, and bounded drift metrics; keep the
      probes excluded from default CI.
- [x] 5.6 TDD the observed wishlist purchase-option contract so
      `final_price_in_cents` is normalized and a null option preserves the item
      without price data.

## 6. Identity Resolution and Player Application Services

- [x] 6.1 TDD the common identity-resolution order of explicit user, local
      `STEAM_USER`, then `IDENTITY_NOT_LINKED`, including proof that the remote
      bearer credential is never treated as Steam identity.
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
- [x] 6.9 TDD optional operator-configured `STEAM_USER` defaulting in local and
      private hosted modes, with explicit-user precedence, no bearer inference,
      and no MCP-managed persistence.

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
- [x] 8.2 TDD the shared MCP tool adapter that invokes application services,
      maps expected failures to `isError: true`, sanitizes unexpected
      exceptions, and derives concise text from structured results.
- [x] 8.3 TDD the single shared tool registry and verify exact tool-name,
      schema, annotation, result, and error parity across transport
      constructions.
- [x] 8.4 TDD the stdio entry point with environment credentials, no unused
      persistence infrastructure, clean initialization and shutdown, actionable
      missing-key behavior, and protocol-only stdout.
- [x] 8.5 Add MCP SDK and Inspector conformance tests for local initialization,
      tool listing, representative executions, cancellation, structured errors,
      and stderr diagnostic isolation.
- [x] 8.6 TDD removal of obsolete account, OAuth, and persistence seams,
      simplify remote configuration to require no database, and update public
      identity guidance while retaining the stable v1 error code.

## 9. Remote Quotas and Concurrency

- [x] 9.1 TDD atomic instance-wide quota reservation, daily rollover, configured
      call costs, safety reserve, same-instance races, and failures. Keep the
      adapter storage-independent and document that multi-instance operation
      requires a distributed atomic implementation outside v1.
- [x] 9.2 TDD per-host and per-operation concurrency acquisition, bounded
      queueing, cancellation, deadlines, release-on-error, and backpressure.
- [x] 9.3 Add high-risk race and fault-injection coverage for quota and
      concurrency cleanup, including proof that process-local state is bounded
      and never persisted to disk.

## 10. Remote Bearer Protection

- [x] 10.1 Supersede the external OAuth ADR with the approved zero-provider-cost
      self-hosted model: one operator-managed static bearer token, no accounts,
      no public shared endpoint, and explicit client limitations.
- [x] 10.2 TDD exact bearer-header acceptance plus generic 401
      `WWW-Authenticate: Bearer` responses for missing, malformed, and incorrect
      credentials before MCP parsing or application work.
- [x] 10.3 TDD constant-time credential comparison, startup rejection of weak or
      missing values, rotation-by-restart behavior, and complete secret
      redaction.
- [x] 10.4 Add high-risk mutation or fault-injection tests proving rejected
      bearer tokens perform no MCP, quota, concurrency, or Steam work and the
      bearer token is never passed upstream.
- [x] 10.5 Add 100 percent branch coverage and targeted mutation or
      fault-injection checks for bearer protection, bearer/Steam-identity
      separation, and credential isolation.

## 11. Remote Streamable HTTP and Operations

- [x] 11.1 TDD the Streamable HTTP MCP endpoint for bearer-authorized
      initialization, request handling, request-abort cancellation, stateless
      operation, canonical URI binding, and rejection of legacy HTTP plus SSE.
- [x] 11.2 TDD configured Origin and Host enforcement before authorization or
      MCP parsing, including missing, malformed, proxy-forwarded, and disallowed
      values.
- [x] 11.3 TDD liveness and readiness endpoints so neither calls Steam and
      startup validation, rather than an external identity dependency, protects
      readiness.
- [x] 11.4 TDD graceful shutdown that marks readiness false, stops new work,
      drains to a deadline, cancels remaining upstream requests, and closes HTTP
      and configured quota clients.
- [x] 11.5 TDD redacted structured events, bounded metrics, privacy-preserving
      drift signals, and secret scrubbing across nested errors and
      credential-bearing URLs.
- [x] 11.6 Add high-risk mutation or fault-injection tests with 100 percent
      branch coverage for bearer and host enforcement, redaction, quota
      accounting, and shutdown cleanup.
- [x] 11.7 TDD the portable `steam-mcp serve` mode that composes the static
      bearer gate, operator-owned Steam adapters, process-local instance quota
      and concurrency enforcement, health routing, and graceful shutdown from
      explicit validated environment configuration. Keep deployment-platform
      manifests and account lifecycle outside the MCP runtime.

## 12. Packaging and Public Documentation

- [x] 12.1 Produce the reproducible public `@abiswas97/steam-mcp` package with
      one `steam-mcp` executable, pinned runtime range, clean install
      verification for default stdio and `serve`, provenance, checksums, and
      release metadata.
- [x] 12.2 Document local client setup for Codex, Claude, OpenAI-compatible
      clients, and MCP Inspector using `STEAM_API_KEY` and optional
      `STEAM_USER`, without example secrets.
- [x] 12.3 Document self-hosted remote connection, bearer secret generation and
      rotation, required explicit Steam users, arbitrary public-profile lookup,
      compatible-client limitations, quotas, privacy limits, and
      troubleshooting.
- [x] 12.4 Document architecture, dependency direction, all eight tool
      contracts, schemas, pagination, errors, source tiers, best-effort
      degradation, security model, data retention, and threat boundaries.
- [x] 12.5 Document strict TDD contribution rules, fixture scrubbing, live-probe
      safety, test commands, coverage gates, compatibility policy, versioning,
      changelog, operations, rollout, and rollback.
- [x] 12.6a Verify the packaged local stdio documentation from clean supported
      Node.js environments, including one public Steam tool call, without
      undocumented maintainer steps.
- [x] 12.6b Verify the self-hosted remote documentation against a clean
      disposable deployment using an out-of-band bearer token and no
      undocumented maintainer steps.
- [x] 12.7 Update public identity and wishlist-source documentation for the
      shared operator default and observed purchase-option shape.

## 13. Release Verification and Rollout

- [x] 13.1 Run fresh full verification for formatting, linting, strict types,
      unit and contract tests, dependency audit, coverage thresholds, and all
      configured mutation or fault-injection gates.
- [x] 13.2a Run deterministic single-instance remote quota and concurrency
      integration suites for races, cancellation, rollover, safety reserve,
      bounded memory, and dependency-failure cleanup and recovery.
- [x] 13.2b Verify the package and documentation make no multi-instance quota
      safety claim; distributed quota and horizontal scaling remain outside v1.
- [x] 13.3 Run opt-in Steam live probes with the dedicated credential, review
      best-effort drift, measure observed call costs, and set documented initial
      quota policies while preserving the safety reserve.
- [x] 13.4 Verify MCP Inspector and documented remote-client paths that support
      a fixed bearer header for initialization, authorization, tool listing,
      representative calls, structured results, errors, and request-abort
      cancellation. Record OAuth-only client paths as unsupported in remote v1.
- [x] 13.5a Execute local deterministic bounded-load, abusive-input, dependency
      outage, graceful-shutdown, and independent best-effort-adapter disablement
      tests.
- [x] 13.5b In a disposable self-hosted deployment, execute a version upgrade
      and restore the previous immutable container without a data migration.
- [ ] 13.6a Publish and verify the scoped npm version and immutable GHCR digest,
      then create the GitHub Release last with checksums, compatibility matrix,
      configuration revision, known limitations, rollback target, approver, and
      observation window.
- [x] 13.6b Verify the release publishes packages and containers only, operates
      no shared public endpoint, and requires both Steam and remote bearer
      secrets before accepting remote work.
