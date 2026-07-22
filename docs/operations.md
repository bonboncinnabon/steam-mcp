# Operations

This runbook covers local stdio and private self-hosted HTTP operation. The
project does not operate a hosted provider, user-account system, public shared
endpoint, or multi-tenant service.

## Operational boundaries

Steam MCP exposes eight read-only Steam data tools. HTTP access is protected by
one operator-configured `MCP_ACCESS_TOKEN` shared with approved clients. The
token is an instance credential only: it has no subject, user lifecycle, Steam
identity, or per-client quota.

The HTTP process does not persist Steam identities, Steam payloads, prompts, or
tool arguments. Its bounded quota and concurrency state is process-local. A
restart resets quota counters, and replicas cannot share an atomic budget. Run
one instance in v1.

## Configuration and secrets

Local stdio mode reads `STEAM_API_KEY` and may use `STEAM_USER` as its default
public profile. Self-hosted HTTP mode requires:

- `STEAM_API_KEY`, supplied by the deployment secret manager;
- `MCP_ACCESS_TOKEN`, a high-entropy secret of at least 32 characters;
- `MCP_RESOURCE_URI`, the exact canonical HTTPS MCP URL;
- `ALLOWED_HOSTS`, including the canonical host and any explicit port;
- optional `ALLOWED_ORIGINS` for exact HTTPS browser origins;
- optional listener, shutdown, capacity, and best-effort source settings
  documented in [Self-hosted HTTP setup](./hosted-setup.md).

HTTP mode rejects `STEAM_USER`; player-oriented tools require an explicit public
Steam user. Never infer Steam identity from the bearer token.

Store both secrets in the platform secret manager with least-privilege access.
Do not place them in command arguments, images, logs, metrics, health responses,
traces, or incident notes. Never print a credential to test it.

## Process and ingress

Start the portable HTTP executable with:

```sh
pnpm dlx --package steam-mcp-server steam-mcp-hosted
```

The executable serves plain HTTP. Terminate TLS at a trusted reverse proxy or
load balancer, preserve the original public `Host`, and forward the exact MCP
route plus `/livez` and `/readyz`. Do not rely on `Forwarded` or
`X-Forwarded-Host`; the application validates the actual `Host` header.

Keep the deployment at one instance. A distributed atomic quota adapter is
required before multiple replicas or restart-safe quota enforcement. A public
shared rollout would additionally require a different authentication and abuse
model and is outside v1.

## Health and shutdown

`GET /livez` reports whether the process can serve HTTP. `GET /readyz` reports
whether the process is accepting work. Static bearer validation has no external
identity-provider dependency, and neither endpoint calls Steam.

Use only these routes for platform health checks. A Steam tool call consumes
instance quota, depends on Steam, and may expose a user argument.

Graceful termination must:

1. mark readiness false;
2. stop accepting new work;
3. drain active requests until the configured deadline;
4. cancel remaining upstream requests;
5. close the HTTP server and any configured quota client.

Set the platform termination grace period longer than
`SHUTDOWN_DRAIN_TIMEOUT_MS`.

## Monitoring and privacy

Monitor bounded dimensions only: tool name, stable result code, source tier,
HTTP status class, approved best-effort adapter name, authentication rejection
reason, quota rejection reason, dependency, and shutdown phase. Useful signals
include:

- bearer rejection rate;
- instance reserve exhaustion;
- queue saturation, concurrency rejection, and tool latency;
- `BEST_EFFORT_SOURCE_CHANGED` by approved adapter;
- Steam authentication, rate-limit, timeout, and availability failures;
- readiness transitions and shutdown deadline exhaustion.

Do not use raw or hashed user identifiers as log or metric labels. Do not record
request bodies, prompts, tool arguments, bearer tokens, Steam keys, SteamIDs,
raw upstream responses, or credential-bearing URLs. Treat a redaction failure as
a security incident: restrict log access, stop affected emission, rotate exposed
credentials, and preserve only sanitized evidence.

## Failure response

### Bearer authentication fails

- Verify that the client sends exactly one fixed `Authorization: Bearer` header.
- Verify server and client secrets through their secret managers without
  printing either value.
- Return `401` for missing, malformed, or incorrect credentials. Never bypass
  the gate or forward the header to Steam.
- If the secret may be exposed, rotate it for the server and all clients, then
  verify the old value is rejected.

### Instance quota pressure

- Confirm whether the usable daily budget or safety reserve caused rejection.
- Preserve the configured safety reserve and check adapter call-cost assumptions
  before changing policy.
- Treat every client as consuming the same instance budget; there is no
  per-token or per-Steam-user accounting.
- Do not restart to recover quota. Process-local counters reset on restart and
  can make the upstream budget appear replenished.

### Steam outage or credential failure

- Keep retry bounds and avoid retry amplification.
- Distinguish credential rejection, rate limiting, and transient outage using
  stable status classes only.
- Rotate a rejected Steam key through the secret manager if Valve confirms it is
  invalid.
- Keep required supported-facet failures terminal where the tool contract
  requires it.

### Best-effort source drift

- Identify the adapter from the bounded drift metric and disable only its
  corresponding environment switch.
- Preserve supported tools and successful optional facets.
- Reproduce with a dedicated live-probe credential, never production traffic.
- Update the source register, scrubbed fixtures, validator, and rollback notes
  before re-enabling the adapter.

### Concurrency saturation

- Confirm host, operation, and queue bounds release capacity after success,
  error, timeout, and cancellation.
- Prefer backpressure to increasing fan-out.
- Check upstream latency and stuck-request cancellation before tuning limits.
- Consider the quota-reset effect before restarting.

## Pre-deployment gate

For each immutable candidate artifact:

1. Install with the frozen pnpm lockfile on each supported Node.js line.
2. Run formatting, lint, strict types, tests, coverage, configured mutation
   checks, dependency audit, and build.
3. Verify artifact provenance, checksums, executable metadata, and contents.
4. Run opt-in Steam probes with the dedicated credential and review only
   sanitized drift output.
5. Against each target client, verify fixed-header support, initialization, tool
   listing, a representative call, invalid-token rejection, and cancellation by
   aborting the original HTTP request.
6. Exercise bounded load, abusive input, graceful shutdown, and independent
   best-effort disablement.
7. Record the exact version or digest, configuration revision, results, known
   limitations, and rollback target.

Client compatibility must be demonstrated against the exact client and version.
An OAuth-only client is incompatible with the v1 HTTP transport. Cross-request
`notifications/cancelled` is also unsupported because one shared bearer token
cannot safely identify which client owns a request. Clients must abort the
original HTTP request to cancel remote work.

## Rollout boundary

Deploy to an operator-controlled, private environment. Admit only approved
clients that have received the shared secret through an appropriate secret
channel. Observe quota, authentication failures, latency, drift, saturation,
memory, and shutdown behavior.

Do not expand this deployment into a public or multi-tenant service. Static
shared bearer authentication cannot provide signup, consent, individual
revocation, client attribution, or per-user abuse controls. Those needs require
a new security design and decision record.

## Rotation and rollback

Rotate `MCP_ACCESS_TOKEN` on suspected exposure, when a client loses access, or
on the operator's regular credential schedule:

1. generate a new high-entropy token;
2. update every approved client and the server secret;
3. restart and drain the prior instance;
4. verify the old token receives `401` and the new token initializes MCP;
5. record only the sanitized rotation outcome.

For a code or configuration regression, route traffic back to a verified
immutable artifact, restore its matching configuration, and recheck health,
bearer rejection, all eight tools, instance quota accounting, and redacted
telemetry. Rollback never means weakening bearer authentication, Host/Origin
validation, quota reserves, redaction, or Steam privacy controls.
