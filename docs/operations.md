# Operations

This runbook covers local/self-hosted operation and the controls required before
a hosted rollout. There is no public hosted endpoint deployed or externally
verified from this repository yet. Do not advertise hosted availability until
the release-verification and staged-rollout gates have produced reviewed
evidence.

## Operational boundaries

Steam MCP exposes only eight read-only Steam data tools. It does not own user
accounts, Steam identity links, or account deletion. The external authorization
provider owns signup, login, consent, token revocation, and its account
lifecycle. Never add an administrative MCP tool that mutates Steam or provider
accounts.

The hosted process is a stateless OAuth resource server. It does not persist
OAuth subjects, Steam identities, Steam payloads, prompts, or tool arguments.
The initial quota adapter keeps bounded counters in one process. A restart
resets them, and multiple replicas cannot share an atomic budget. A distributed
atomic quota implementation is therefore a hard prerequisite for horizontal
scaling or broad public access.

## Configuration and secrets

Local stdio mode reads `STEAM_API_KEY` and may use `STEAM_USER` as its default
public profile. Hosted mode requires:

- `STEAM_API_KEY`, supplied by the deployment secret manager;
- `OAUTH_ISSUER`, an HTTPS external authorization-server issuer;
- `MCP_RESOURCE_URI`, the exact canonical HTTPS MCP resource URI;
- deployment-level allowed Host and Origin values;
- validated service-policy values for timeout, retries, quota, concurrency,
  fan-out, pagination, execution deadline, and output size.

Hosted mode rejects `STEAM_USER`; subject-oriented tools require an explicit
public Steam user. OAuth subjects are authorization identities and must never be
treated as Steam identities. Tokens and Steam keys must not appear in command
arguments, images, logs, metrics, health responses, traces, or incident notes.

Use the platform secret manager and least-privilege access. Rotate a suspected
Steam key or authorization credential at its owner, restart the affected
processes with the new secret, and verify only sanitized success/failure
signals. Never print a credential to test whether rotation succeeded.

## Health and shutdown

`GET /livez` reports whether the process can serve HTTP. `GET /readyz` reports
whether the service is accepting work and whether required authorization and
configured quota dependencies are ready. Neither endpoint calls Steam.

Route load-balancer liveness and readiness checks only to those paths. Do not
use a Steam tool call as a health check because it consumes quota, depends on
Steam availability, and may expose a user argument.

Graceful termination must:

1. mark readiness false;
2. stop accepting new work;
3. drain active requests until the configured deadline;
4. cancel remaining upstream requests;
5. close the HTTP server and any configured quota client.

The platform termination grace period must exceed the application drain
deadline. A process that remains ready while terminating or is killed before the
deadline has elapsed is a deployment configuration error.

## Monitoring and privacy

Monitor bounded dimensions only: tool name, stable result code, source tier,
HTTP status class, approved best-effort adapter name, authorization rejection
reason, quota rejection reason, dependency, and shutdown phase. Useful signals
include:

- authorization rejection and authorization-dependency failure rates;
- global-reserve and per-user quota rejection rates;
- queue saturation, concurrency rejection, and tool latency;
- `BEST_EFFORT_SOURCE_CHANGED` by approved adapter;
- supported Steam authentication, rate-limit, timeout, and availability
  failures;
- readiness transitions and shutdown deadline exhaustion.

Do not use raw or hashed user identifiers as log or metric labels. Do not record
request bodies, prompts, tool arguments, bearer tokens, Steam keys, SteamIDs,
raw upstream responses, or credential-bearing URLs. Treat a redaction failure as
a security incident: restrict log access, stop affected emission, rotate exposed
credentials, preserve only sanitized diagnostic evidence, and follow the hosting
platform's deletion and notification process.

## Failure response

### Authorization unavailable or invalid

- Confirm readiness and provider health without logging tokens.
- Verify issuer, canonical resource audience, published keys, scope, and token
  status configuration.
- Return safe 401, 403, or dependency-unavailable responses; do not bypass
  validation or pass MCP tokens upstream.
- If the provider is unavailable, keep the service unready until validation is
  reliable.

### Quota pressure

- Confirm whether per-user budget, usable global budget, or the safety reserve
  caused rejection.
- Preserve the configured global safety reserve. Do not raise limits based only
  on a single user's request.
- Check retry and adapter call-cost assumptions before changing policy.
- A restart is not quota recovery: process-local counters reset and can make the
  budget appear replenished. Reconcile conservatively before resuming a hosted
  cohort.

### Supported Steam API outage or authentication failure

- Stop retry amplification and keep configured retry bounds.
- Distinguish credential rejection from rate limiting and transient outage using
  stable status classes only.
- Rotate a rejected service key through the secret manager if Valve confirms it
  is invalid; do not expose the key in diagnostics.
- Supported-facet failure remains terminal where the tool contract requires it.

### Best-effort source drift

- Identify the adapter from the bounded drift metric, then disable that adapter
  independently when its deployment switch is wired and verified.
- Preserve supported tools and successful optional facets; return the stable
  drift error or partial-result warning.
- Reproduce with a dedicated live-probe credential, never production traffic.
- Update the source register, scrubbed fixtures, validator, and rollback notes
  before re-enabling the adapter.

### Concurrency saturation

- Confirm host, operation, and queue bounds are functioning and requests release
  capacity after success, error, timeout, and cancellation.
- Prefer backpressure to increasing fan-out. Check upstream latency and stuck
  request cancellation before tuning limits.
- Restart only after evaluating its quota-reset effect.

## Pre-deployment gate

For each immutable candidate artifact:

1. Install with the frozen pnpm lockfile on every supported Node.js line.
2. Run formatting, lint, strict types, unit/contract/conformance tests,
   coverage, the high-risk suite, configured mutation checks, dependency audit,
   and build.
3. Verify artifact provenance, checksums, executable metadata, and package
   contents.
4. Run opt-in Steam probes with the dedicated credential and manually review
   sanitized drift output.
5. Exercise initialization, OAuth discovery, authorization, tool listing,
   representative success and error calls, and cancellation against each target
   client in staging.
6. Exercise bounded load, abusive input, dependency outage, graceful shutdown,
   and independent best-effort disablement.
7. Record the exact version/digest, configuration revision, results, known
   limitations, and rollback target. Failed or missing evidence blocks rollout.

Do not infer external compatibility from unit tests. Hosted client and OAuth
claims become supported only after staging verification has been recorded.

## Staged rollout

1. Deploy the candidate to an isolated staging resource and complete the
   pre-deployment gate.
2. Deploy one hosted instance with process-local quota accounting and no public
   traffic. Verify liveness, readiness, OAuth audience binding, Host/Origin
   policy, telemetry redaction, and graceful shutdown.
3. Admit only an explicitly approved, quota-limited cohort. Watch Steam budget,
   authorization failures, latency, drift, saturation, memory, and shutdown
   behavior through a complete observation window.
4. Pause expansion on unexplained error growth, redaction concerns, budget
   uncertainty, source drift, or dependency instability.
5. Expand only after reliability, privacy, capacity, client compatibility, and
   Steam-budget gates pass. Add a distributed atomic quota backend before a
   second instance or broad public rollout.

Record who approved each stage and the immutable artifact digest. Configuration
changes use the same staged path as code changes when they affect credentials,
authorization, quotas, concurrency, hosts, origins, upstream requests, or
privacy.

## Rollback

Prepare and verify a known-good immutable artifact before rollout. Roll back
when a release causes contract incompatibility, authorization bypass or outage,
secret exposure, unbounded quota/concurrency behavior, sustained readiness
failure, unsafe telemetry, or material Steam source regression.

1. Stop cohort expansion and mark the candidate instances unready.
2. If one best-effort adapter is responsible, disable only that adapter when the
   switch has been verified; otherwise route traffic to the known-good artifact.
3. Allow candidate instances to drain to their deadline, then terminate them.
4. Restore the prior configuration revision together with the prior artifact; do
   not mix unverified schema or policy changes across versions.
5. Verify health, OAuth discovery and audience checks, all eight tool listings,
   a bounded representative call, quota accounting, and redacted telemetry.
6. Reconcile the Steam budget conservatively because process restarts reset
   in-memory quota counters.
7. Document the sanitized timeline, affected version/digest, trigger, outcome,
   and follow-up regression test.

Rollback never means weakening OAuth, Host/Origin validation, the quota safety
reserve, redaction, or Steam privacy behavior. If the known-good release cannot
meet those boundaries, keep the hosted service unavailable while local stdio
remains an independently configured option.
