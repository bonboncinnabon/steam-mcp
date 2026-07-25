## 1. Package and CLI Contract

- [x] 1.1 Add failing CLI tests for default stdio, `serve`, and unsupported
      arguments
- [x] 1.2 Implement one typed CLI dispatcher and keep the executable wrapper
      thin
- [x] 1.3 Add failing package metadata tests for `@abiswas97/steam-mcp`, public
      access, and one bin
- [x] 1.4 Rename the package, remove the hosted bin, and update the pnpm
      lockfile
- [x] 1.5 Update package verification to exercise stdio and hosted failure
      behavior through the one bin

## 2. Dead-Code Removal and Focused Refactoring

- [x] 2.1 Remove dormant observability production code and its isolated tests
- [x] 2.2 Remove orphan tag adapter, request operation, port contract, and
      isolated tests/live probe
- [x] 2.3 Remove unused clock/cancellation ports, test-only concurrency helper,
      redundant placeholders, empty speculative directories, and unused `tsx`
- [x] 2.4 Replace repeated subject-input casts with exact typed mapping
- [x] 2.5 Consolidate best-effort source configuration behind one typed keyed
      object

## 3. Typed Failures and Diagnostics

- [x] 3.1 Add failing Steam HTTP tests for typed deadline, cancellation, and
      terminal network failures
- [x] 3.2 Preserve `SteamUpstreamError` semantics without retaining unsafe error
      causes
- [x] 3.3 Add failing lifecycle tests for cleanup-failure diagnostics
- [x] 3.4 Report fixed shutdown and request failure categories while keeping
      remote responses generic
- [x] 3.5 Add failing executable tests for safe actionable startup diagnostics

## 4. Bounded Hosted HTTP

- [x] 4.1 Add failing config tests for loopback default and bounded request
      configuration
- [x] 4.2 Default hosted listeners to loopback and add `maxRequestBytes` to
      validated policy/config
- [x] 4.3 Add failing Node HTTP tests for declared and streamed oversized bodies
- [x] 4.4 Buffer and bound inbound MCP request bodies and return HTTP 413
- [x] 4.5 Add failing tests for explicit header/request timeouts and configure
      them on the Node server
- [x] 4.6 Remove duplicate Host/Origin enforcement while preserving pre-auth
      rejection behavior

## 5. Behavioral Packaging and CI

- [x] 5.1 Add a process-level packaged `steam-mcp serve` success and
      graceful-shutdown smoke
- [x] 5.2 Run Inspector conformance in CI and run the built container health
      smoke
- [x] 5.3 Replace brittle workflow/Dockerfile source-text assertions with
      behavior and metadata contracts
- [x] 5.4 Make release tag-driven, publish/verify npm and GHCR before creating
      GitHub Release, and record immutable evidence
- [x] 5.5 Pin container base images by digest and trim internal docs/maps from
      the public tarball

## 6. Documentation and Release Alignment

- [x] 6.1 Update README and local/hosted/operations/architecture docs for the
      scoped package and `serve`
- [x] 6.2 Update OpenSpec build artifacts and release instructions that still
      name the old package or executable
- [x] 6.3 Add a documentation command consistency check against package metadata

## 7. Verification

- [x] 7.1 Run focused tests after every red-green-refactor slice
- [x] 7.2 Run formatting, lint, strict typecheck, full coverage, high-risk,
      Inspector, mutation, package, and container gates
- [x] 7.3 Run sanitized live Steam and exact-client checks, record deferred
      external release evidence accurately
- [x] 7.4 Review the final diff for dead code, stale names, generated residue,
      and secrets
