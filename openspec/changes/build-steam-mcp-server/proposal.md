## Why

Existing general-purpose Steam MCP servers largely require local installation.
This change creates a heavily tested Steam MCP that supports both local use and
a simple self-hosted remote endpoint without introducing an account system or a
paid identity-provider dependency.

## What Changes

- Add a self-hosted, read-only MCP server over Streamable HTTP protected by one
  operator-configured bearer token.
- Require an explicit public Steam user for remote subject-oriented calls while
  retaining optional `STEAM_USER` defaults for local use.
- Add explicit lookup of any public Steam profile using a SteamID64, vanity
  name, or Steam Community profile URL.
- Add eight curated tools for player profiles, libraries, recent activity,
  achievements, friends, wishlists, game search, and game details.
- Add structured, versioned result and error contracts with bounded pagination
  and partial-result reporting.
- Add isolated support for documented Steam Web API operations and clearly
  labeled best-effort Steam-operated public endpoints.
- Add instance-wide quota enforcement, concurrency limits, retry policy,
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

- `hosted-mcp-access`: Self-hosted Streamable HTTP access, static bearer-token
  protection, health behavior, and compatible client connectivity.
- `steam-user-identity`: Explicit Steam user resolution and optional local
  default identity without remote identity persistence.
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
  service layers, typed Steam adapters, MCP tool registration, and remote and
  local transports.
- Adds stable public MCP tool names, schemas, result envelopes, error codes,
  identity-resolution rules, and versioning commitments.
- Adds deployment secret management and HTTPS ingress for self-hosted remote
  operation. A distributed quota backend is required only before horizontal
  scaling.
- Adds build, packaging, container, CI, security scanning, observability,
  release, and rollback workflows.
- Adds public security, privacy, tool-reference, source-matrix, contributor,
  test-strategy, and operations documentation.
- Does not import Claude’s prototype implementation; that archive remains
  endpoint research only.
