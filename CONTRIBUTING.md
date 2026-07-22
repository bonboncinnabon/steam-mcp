# Contributing

Steam MCP is a read-only data-access server with security-sensitive bearer
authentication, quota, host-validation, and redaction boundaries. Contributions
should stay small, preserve the inward dependency direction described in the
architecture documentation, and avoid adding account management, Steam
mutations, generic HTTP proxying, or analysis behavior.

## Development environment

Use a Node.js version accepted by `package.json` and the pinned pnpm release:

```sh
corepack enable
corepack prepare pnpm@11.15.1 --activate
pnpm install --frozen-lockfile
```

Use pnpm for every repository command. Do not create or commit an npm or Yarn
lockfile, and do not replace a frozen install with an unconstrained dependency
install in CI or release evidence.

## Required Red-Green-Refactor flow

Every observable production behavior and defect fix must follow one focused
Red-Green-Refactor cycle at a time:

1. Describe one observable behavior and add one focused test.
2. Run only that test and confirm it fails for the missing behavior. A syntax,
   fixture, configuration, or environment failure is not a valid red.
3. Record the focused command and a short, scrubbed failure excerpt.
4. Add the smallest implementation that makes that test pass.
5. Run the identical command and record the green result.
6. Refactor without changing behavior, then run the affected suite.
7. Begin a new cycle for each boundary, empty, privacy, cancellation, network,
   or concurrency case.

For example:

```sh
pnpm test:unit -- test/unit/domain/steam-id.test.ts -t "preserves SteamID64 exactly"
```

Do not write production behavior first and backfill tests. A bug fix starts with
a failing regression test. Protocol and operational behaviors may need a
contract, integration, or conformance test instead of a unit test, but the same
cycle applies.

Include this compact evidence in the change or pull request:

```text
Behavior:
Focused test:
Red command:
Expected red reason:
Observed red evidence:
Green command:
Observed green evidence:
Affected-suite command:
Affected-suite result:
```

Never include access tokens, API keys, raw Steam responses, prompts, tool
arguments, personal identifiers, or credential-bearing URLs in evidence.

## Test commands and gates

Run the narrowest relevant command during development, followed by checks
proportional to the change:

```sh
pnpm test:unit
pnpm test:contract
pnpm test:inspector
pnpm test:high-risk
pnpm mutation
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
```

`pnpm check` runs formatting, linting, strict type checking, and the normal
coverage suite. CI also performs a frozen install, build, dependency audit, and
configured high-risk mutation checks. Overall line and branch coverage must be
at least 90 percent. Bearer authentication, identity separation, secret
redaction, quota accounting, Host enforcement, and shutdown cleanup require 100
percent branch coverage plus their configured mutation or fault-injection
checks.

Coverage is a floor, not evidence that failure paths, races, or security
boundaries are correct. Add explicit tests for empty input, missing data,
limits, cancellation, concurrency, upstream failure, and cleanup whenever they
are relevant.

## Fixture scrubbing

Steam HTTP fixtures are synthetic, minimal contract examples, not saved live
responses. Before committing a fixture:

1. Replace SteamID64 values, vanity names, user-authored text, and other
   identifiers with synthetic values.
2. Remove API keys, bearer tokens, cookies, authorization headers, complete
   URLs, email addresses, timestamps, and unrelated fields.
3. Keep only the fields required by the test.
4. Run `pnpm test:contract` and inspect the staged diff for key-like values.

The automated fixture scanner is a guardrail, not a substitute for manual
review. Do not weaken a scanner rule to admit captured personal or secret data.
Live-probe responses must never be written into `test/fixtures` automatically.

## Live-probe safety

Live Steam probes are opt-in, excluded from default CI, and must use a dedicated
test account and credential:

```sh
STEAM_LIVE_TESTS=1 \
STEAM_LIVE_TEST_API_KEY=<resolved-by-the-shell> \
STEAM_LIVE_TEST_STEAM_ID=<dedicated-test-account-steamid64> \
pnpm test:live
```

Do not reuse the normal `STEAM_API_KEY`, a personal Steam account, or a
production credential. Resolve secrets at execution time without printing them.
Review output before sharing it. Probes may emit only bounded probe-name and
outcome counters; they must not persist raw responses.

Changes to a best-effort Steam source also require updating
`docs/upstream-sources.md`, adding scrubbed contract coverage, and keeping the
live probe opt-in. Review its host, request shape, data classification, call
cost, response bound, drift behavior, and independent disable path.

## Compatibility, versions, and changelog

The structured v1 tool result, error, input, and output schemas are the public
compatibility contract. Descriptions and human-readable text may become clearer
without changing meaning. Within a stable major version:

- additive optional fields, optional facets, and new non-breaking metadata use a
  minor release;
- fixes that preserve documented contracts use a patch release;
- removing or renaming a tool, field, enum value, error code, source-tier
  meaning, identity rule, pagination behavior, or supported runtime/client
  requires a major release and migration notes.

Before 1.0, the project may still change quickly, but every user-visible
incompatibility must be called out explicitly. Do not silently reinterpret an
existing field or error. Dependency and runtime changes require fresh
compatibility verification on the supported Node.js and MCP client matrix.

Update `CHANGELOG.md` under `Unreleased` in the same change. Use the categories
Added, Changed, Deprecated, Removed, Fixed, and Security as applicable. Describe
user-visible behavior and migration impact rather than implementation details.
Release preparation moves those entries into a versioned, dated section only
after the release artifact and evidence exist.

## Pull-request checklist

- The change is within the read-only Steam data-access scope.
- Each behavior has focused red and green evidence.
- Fixtures and captured output are scrubbed and manually reviewed.
- Relevant narrow suites and `pnpm check` pass freshly.
- High-risk gates run when a protected boundary changes.
- Public contracts, operations guidance, and `CHANGELOG.md` are updated.
- No generated package, coverage output, secret, or personal data is committed.
