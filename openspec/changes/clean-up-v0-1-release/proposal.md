## Why

The pre-release implementation has a strong tested core, but its current package
identity can install an unrelated npm package, it exposes two executables for
one product, and its hosted transport lacks several bounded-failure guarantees.
A deep review also found substantial dormant infrastructure and brittle release
checks that should be removed before the first public version makes them part of
the maintenance surface.

## What Changes

- **BREAKING** Rename the public package from `steam-mcp-server` to
  `@abiswas97/steam-mcp`.
- **BREAKING** Replace the separate `steam-mcp-hosted` executable with one
  `steam-mcp` executable whose default is stdio and whose `serve` subcommand
  starts Streamable HTTP.
- Publish the package as public npm software and align documentation, container
  packaging, verification, and release automation with that identity.
- Bound inbound hosted requests by size and time, use a loopback-safe default
  listener, preserve typed Steam failure semantics, and surface sanitized
  transport and shutdown diagnostics.
- Replace static packaging assertions with process-level package, Inspector,
  HTTP, and container behavior checks.
- Remove confirmed dormant observability, tag, port, helper, dependency, and
  placeholder code.
- Consolidate duplicated MCP wiring and subject-resolution mapping only where a
  smaller typed contract replaces existing repetition.

## Capabilities

### New Capabilities

- `single-package-distribution`: One scoped npm package, one executable, stdio
  by default, an explicit `serve` mode, and verifiable public release artifacts.
- `bounded-http-operation`: Self-hosted HTTP request bounds, safe listener
  defaults, typed failure behavior, and observable graceful shutdown.

### Modified Capabilities

None. The existing change has not yet been archived into baseline specs; this
pre-release cleanup supersedes its packaging and hosted-runtime details before
the initial release evidence is recorded.

## Impact

This affects the npm package name, CLI surface, Docker command, setup and
operations documentation, release workflow, hosted Node HTTP bridge, Steam HTTP
failure mapping, shutdown lifecycle, MCP registration wiring, tests, and the
unreleased OpenSpec delivery evidence. There is no released compatibility
obligation because version `0.1.0` has not been published.
