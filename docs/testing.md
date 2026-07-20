# Testing and TDD

Every observable production behavior and every defect fix follows one focused
Red-Green-Refactor cycle. Production code must not be written before the test
that requires it has failed for the intended reason.

## Focused cycle

1. Describe one externally observable behavior and its single most important
   assertion.
2. Add one focused test. Do not add the adjacent boundary tests yet.
3. Run only that test and record the command, expected failure, and relevant
   failure line in the current change or pull request evidence.
4. Confirm the failure is caused by the missing behavior, not by syntax,
   configuration, fixture, or environment problems.
5. Add the smallest implementation that can satisfy the test.
6. Run the same command and record the passing result.
7. Refactor names and structure without changing behavior, then run the affected
   suite.
8. Start a new cycle for the next normal, boundary, empty, privacy, network, or
   concurrency behavior.

Use a test file or test-name filter to keep the cycle narrow:

```sh
pnpm test:unit -- test/unit/domain/steam-id.test.ts -t "preserves SteamID64 exactly"
```

Run broader checks only after the focused test is green:

```sh
pnpm test:unit
pnpm test:contract
pnpm typecheck
pnpm lint
pnpm test:coverage
```

Live Steam probes are opt-in and are never part of the default test command:

```sh
STEAM_API_KEY=<resolved-by-the-shell> pnpm test:live
```

Never paste the resolved key into evidence, fixtures, command output, or source
control.

## Evidence template

Record this compact block for each cycle in the active change notes or pull
request description:

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

The evidence is a review aid, not a substitute for committed tests. Red output
must be short and scrubbed. Never record credentials, tokens, raw Steam
responses, prompts, tool arguments, or personal identifiers.

## Test layers

- Unit tests cover pure domain rules and application services.
- Contract tests cover MCP schemas and scrubbed Steam adapter responses.
- Integration tests cover process, PostgreSQL, Redis-compatible, OAuth, and
  transport boundaries.
- Live tests probe approved Steam contracts with a dedicated credential.
- Mutation and fault-injection tests target authorization, identity isolation,
  redaction, quota accounting, and host enforcement.
- Release tests cover supported clients, load, shutdown, rollout, and rollback.

Coverage is a release floor, not proof of correctness. Overall line and branch
coverage must remain at or above 90 percent. High-risk behavior additionally
requires complete branch coverage and its configured mutation or fault-injection
checks.
