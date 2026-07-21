## Why

Existing general-purpose Steam MCP servers largely require local installation
and a user-managed Steam API key. This change creates a heavily tested,
remote-first Steam MCP that ordinary users can authorize through OAuth while
preserving local and self-hosted access for users who prefer their own key.

## What Changes

- Add a hosted, read-only MCP server over Streamable HTTP with
  standards-compliant OAuth 2.1 authorization.
- Require an explicit public Steam user for hosted subject-oriented calls while
  retaining optional `STEAM_USER` defaults for local use.
- Add explicit lookup of any public Steam profile using a SteamID64, vanity
  name, or Steam Community profile URL.
- Add eight curated tools for player profiles, libraries, recent activity,
  achievements, friends, wishlists, game search, and game details.
- Add structured, versioned result and error contracts with bounded pagination
  and partial-result reporting.
- Add isolated support for documented Steam Web API operations and clearly
  labeled best-effort Steam-operated public endpoints.
- Add global and per-user quota enforcement, concurrency limits, retry policy,
  source-drift detection, and redacted observability.
- Add local and self-hosted `stdio` operation using `STEAM_API_KEY` and optional
  `STEAM_USER` configuration.
- Add strict data-minimization boundaries, operational runbooks, and
  cross-client compatibility checks without creating an MCP account system.
- Enforce strict one-test-at-a-time Red-Green-Refactor development and
  comprehensive behavioral, protocol, security, concurrency, live-contract, and
  operational verification.

## Capabilities

### New Capabilities

- `hosted-mcp-access`: Remote Streamable HTTP access, MCP OAuth discovery and
  authorization, health behavior, and cross-client connectivity.
- `steam-user-identity`: Explicit Steam user resolution and optional local
  default identity without hosted identity persistence.
- `steam-player-tools`: Player, library, activity, achievement, friend, and
  wishlist tool behavior.
- `steam-game-tools`: Game search and consolidated game-details behavior.
- `steam-upstream-reliability`: Steam credential handling, source-tier
  classification, host restrictions, quotas, concurrency, retries, partial
  results, and stable errors.
- `local-mcp-access`: Local and self-hosted `stdio` execution using
  environment-provided Steam configuration.
- `security-privacy-operations`: Data minimization, secret redaction,
  observability, deployment safety, and release quality gates.

### Modified Capabilities

None. This repository has no existing OpenSpec capability specifications.

## Impact

- Introduces a TypeScript MCP application with transport-independent domain and
  service layers, typed Steam adapters, MCP tool registration, and hosted and
  local transports.
- Adds stable public MCP tool names, schemas, result envelopes, error codes,
  identity-resolution rules, and versioning commitments.
- Adds hosted dependencies for an external OAuth/OIDC authorization server,
  deployment secret management, and HTTPS ingress. A distributed quota backend
  is required only before horizontally scaled public operation.
- Adds build, packaging, container, CI, security scanning, observability,
  release, and rollback workflows.
- Adds public security, privacy, tool-reference, source-matrix, contributor,
  test-strategy, and operations documentation.
- Does not import Claude’s prototype implementation; that archive remains
  endpoint research only.
