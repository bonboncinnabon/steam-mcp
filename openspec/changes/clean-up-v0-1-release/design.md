## Context

The unreleased server currently has two Node entry points, an npm identity owned
by another maintainer, a release workflow that does not publish npm, and a
self-hosted Node HTTP bridge without inbound request bounds. The implementation
also contains production-unreachable observability and tag subsystems, unused
ports and helpers, and packaging tests that assert source text instead of
running the packaged behavior.

The existing transport-independent application core remains the correct
architecture. This change narrows and hardens its public and operational edges
without changing the eight read-only Steam tool contracts.

## Goals / Non-Goals

**Goals:**

- Ship one scoped npm package with one executable.
- Keep stdio as the zero-argument default and expose HTTP through `serve`.
- Make install, package, container, registry, and release metadata agree.
- Bound hosted input size and receive time before MCP parsing.
- Preserve stable typed failures and surface sanitized operational failure
  categories.
- Remove code that has no production consumer.
- Replace low-signal static packaging tests with process-level evidence.

**Non-Goals:**

- Operate a public hosted service or add OAuth.
- Change the eight tool names or their input/output contracts.
- Add GFN support, recommendations, account persistence, or Steam mutations.
- Introduce a plugin framework, generic pagination framework, or telemetry
  platform.

## Decisions

### One CLI with two explicit modes

`steam-mcp` starts stdio and `steam-mcp serve` starts Streamable HTTP. A small
typed CLI module owns argument parsing and delegates to separate internal stdio
and HTTP runners; the executable wrapper remains thin. Unknown arguments fail
with a concise usage message. The container invokes `steam-mcp serve`.

This keeps the two operationally different transports testable without making
them separate products. Environment-only transport selection was rejected
because it hides consequential behavior.

### Scoped public npm package and tag-driven release

The package is `@abiswas97/steam-mcp`, exposes only the `steam-mcp` bin, and
sets `publishConfig.access` to `public`. CI and release use pnpm for dependency,
build, and test work. npm CLI is permitted only for registry publication because
npm trusted publishing requires it.

Release starts from a `v*` tag, verifies first, publishes npm and GHCR, records
artifact identity, and creates the GitHub Release last. The first `0.1.0`
package may be manually bootstrapped from the verified tarball; the automated
publish step treats an already-published identical version as idempotent.

### Buffer bounded MCP request bodies

The Node bridge rejects declared or streamed request bodies larger than the
configured `maxRequestBytes` before MCP parsing. Bounded buffering is simpler
and safer than adapting an unbounded Node stream; MCP JSON requests are small
and response streaming remains unchanged. The HTTP server also sets explicit
header and request timeouts. Hosted mode defaults to `127.0.0.1`; containers
explicitly opt into `0.0.0.0`.

### Typed upstream failures and minimal diagnostics

Steam deadlines and exhausted network failures become typed `SteamUpstreamError`
values rather than plain errors. External HTTP and MCP responses stay generic.
Transport and cleanup layers accept a small diagnostic callback that receives a
closed failure category; the CLI writes only fixed sanitized messages to stderr.

The dormant general-purpose redaction/observability framework is removed rather
than wired in solely to justify its existence.

### Delete unshipped code instead of preserving experiments

The orphan tag adapter and request operation, dormant observability subsystem,
unused clock/cancellation ports, test-only concurrency helper, unused direct
dependency, redundant `.gitkeep` files, and empty speculative directories are
removed. They can return in a future change when demanded by a public behavior.

### Consolidate only proven duplication

Subject-input mapping and best-effort configuration use one typed source of
truth. MCP schema files may be split for readability, but the change will not
introduce a generic registry framework unless it removes existing casts and
hand-synchronized names with less code.

## Risks / Trade-offs

- **CLI change breaks unreleased commands** → Update all package, docs,
  container, Inspector, and client examples atomically.
- **Bounded buffering adds one request-sized allocation** → Keep the default
  small and configurable; reject before allocation when `Content-Length` exceeds
  it.
- **Loopback default surprises container users** → Set `LISTEN_HOST=0.0.0.0`
  explicitly in the container and document why.
- **Deleting dormant code loses speculative work** → Git history retains it;
  production has no obligation to carry unused contracts.
- **Manual first npm bootstrap differs from later OIDC releases** → Publish only
  the verified tarball and record its digest; configure trusted publishing
  immediately afterward.

## Migration Plan

1. Land the cleanup before the unreleased `0.1.0` tag.
2. Run package, Inspector, HTTP process, container, live Steam, and full test
   gates.
3. Push the cleaned history and obtain green CI.
4. Manually publish the verified `0.1.0` tarball if the scoped package does not
   yet exist, then configure the trusted publisher.
5. Run the tag release to publish/verify GHCR and create the GitHub Release
   last.
6. Record the final evidence in the original build change and archive both
   completed changes.

Rollback before release is a Git revert. After release, npm rollback moves the
dist-tag to a prior version and deprecates the bad version; container rollback
uses the prior immutable digest.

## Open Questions

None. The user approved the package scope, one executable, stdio default,
`serve` HTTP mode, direct `0.1.0` release, and manual local live-Steam sign-off.
