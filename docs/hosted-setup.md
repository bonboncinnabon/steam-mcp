# Self-hosted HTTP setup

Steam MCP can run as a stateless Streamable HTTP server protected by one
operator-configured bearer token. This is a private self-hosting option, not a
hosted product: the project provides no provider account, login flow, public
shared URL, or per-user tenancy.

Every remote client receives the same deployment secret and must send it on each
MCP request:

```http
Authorization: Bearer <MCP_ACCESS_TOKEN>
```

Use this mode only with clients that can attach a fixed `Authorization` header.
Clients that require OAuth discovery or an interactive login are not compatible
with the v1 remote transport.

## Run the executable

The package exposes one `steam-mcp` executable. The `serve` subcommand selects
self-hosted Streamable HTTP instead of the default stdio transport:

```sh
pnpm dlx @abiswas97/steam-mcp serve
```

From a source checkout:

```sh
pnpm install --frozen-lockfile
pnpm build
node dist/bin/steam-mcp.js serve
```

The process listens on plain HTTP. Put it behind a trusted TLS-terminating
reverse proxy for any traffic that leaves the host.

## Run the published container

Each versioned release publishes a multi-platform image at
`ghcr.io/bonboncinnabon/steam-mcp`. Pin the immutable digest recorded by the
release, pass configuration through the platform's secret and environment
facilities, and publish the container's port 3000 only through the trusted TLS
proxy:

```sh
docker run --rm -p 127.0.0.1:3000:3000 \
  --env STEAM_API_KEY \
  --env STEAM_USER \
  --env MCP_ACCESS_TOKEN \
  --env MCP_RESOURCE_URI \
  --env ALLOWED_HOSTS \
  ghcr.io/bonboncinnabon/steam-mcp@sha256:<release-digest>
```

Omit `--env STEAM_USER` when no shared default is wanted. The release workflow
publishes this image and downloadable package artifacts only; it does not deploy
or operate an MCP endpoint.

## Required configuration

| Variable           | Required | Purpose                                               |
| ------------------ | -------- | ----------------------------------------------------- |
| `STEAM_API_KEY`    | Yes      | Deployment-owned Steam Web API credential             |
| `STEAM_USER`       | No       | Shared default SteamID64, vanity name, or profile URL |
| `MCP_ACCESS_TOKEN` | Yes      | Shared high-entropy bearer secret, at least 32 chars  |
| `MCP_RESOURCE_URI` | Yes      | Exact canonical HTTPS MCP endpoint                    |
| `ALLOWED_HOSTS`    | Yes      | Comma-separated request `Host` allowlist              |

Example:

```sh
export STEAM_API_KEY="<deployment Steam Web API key>"
export STEAM_USER="<optional shared default Steam user>"
export MCP_ACCESS_TOKEN="<random secret of at least 32 characters>"
export MCP_RESOURCE_URI="https://mcp.example.com/mcp"
export ALLOWED_HOSTS="mcp.example.com"
pnpm dlx @abiswas97/steam-mcp serve
```

Generate `MCP_ACCESS_TOKEN` with a cryptographically secure secret generator.
The value must contain at least 32 characters and may use letters, digits, and
`._~+/=-`. Store it in the deployment secret manager. Do not put it in source
control, URLs, tool arguments, shell history, logs, or client-visible output.

`MCP_RESOURCE_URI` must be HTTPS, contain no credentials, query, or fragment,
and have a host present in `ALLOWED_HOSTS`. Entries in `ALLOWED_HOSTS` are host
values such as `mcp.example.com` or `mcp.example.com:8443`, not URLs or paths.
When configured, `STEAM_USER` is one operator-wide default for every authorized
client. It is convenience configuration, not a per-client account link.

## Listener and browser origins

| Variable                    | Default     | Behavior                                                        |
| --------------------------- | ----------- | --------------------------------------------------------------- |
| `ALLOWED_ORIGINS`           | empty       | Comma-separated HTTPS browser origins; origin-less clients work |
| `LISTEN_HOST`               | `127.0.0.1` | Node HTTP bind host                                             |
| `PORT`                      | `3000`      | Node HTTP bind port, from 1 through 65535                       |
| `MAX_REQUEST_BYTES`         | `1048576`   | Maximum inbound MCP request body, up to 16777216 bytes          |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | `10000`     | Drain deadline in milliseconds, maximum 60000                   |

An empty `ALLOWED_ORIGINS` permits clients that omit `Origin` and rejects every
request that includes it. Each configured origin must be an exact HTTPS origin.
Set `LISTEN_HOST=0.0.0.0` only when the process must accept traffic from outside
its host or container network. The published container sets that value
explicitly.

Terminate TLS at a trusted proxy or load balancer, preserve the original public
`Host`, and forward the exact MCP path plus `/livez` and `/readyz`. The server
does not trust `Forwarded` or `X-Forwarded-Host` to override a rejected `Host`.
Reject bodies above `MAX_REQUEST_BYTES` and bound unauthenticated connections
and request rates at that edge before forwarding traffic. The application body
limit is a final safety net, not a replacement for edge admission control.

## Quota, concurrency, and execution policy

| Variable                     | Default  | Purpose                                   |
| ---------------------------- | -------- | ----------------------------------------- |
| `UPSTREAM_TIMEOUT_MS`        | `8000`   | Per-upstream deadline                     |
| `MAX_RETRY_ATTEMPTS`         | `2`      | Bounded retry attempts                    |
| `GLOBAL_DAILY_QUOTA`         | `80000`  | Process-local daily instance cost budget  |
| `GLOBAL_SAFETY_RESERVE`      | `20000`  | Protected portion of the instance budget  |
| `MAX_HOST_CONCURRENCY`       | `8`      | Concurrent work per Steam host            |
| `MAX_OPERATION_CONCURRENCY`  | `4`      | Concurrent work per operation             |
| `MAX_CONCURRENCY_QUEUE_SIZE` | `64`     | Bounded admission queue and HTTP capacity |
| `MAX_TOOL_FAN_OUT`           | `20`     | Maximum composite-tool fan-out            |
| `DEFAULT_PAGE_SIZE`          | `20`     | Default paginated result size             |
| `MAX_PAGE_SIZE`              | `100`    | Maximum paginated result size             |
| `EXECUTION_DEADLINE_MS`      | `30000`  | Overall tool execution deadline           |
| `MAX_OUTPUT_BYTES`           | `256000` | Response and upstream body size bound     |

Quota is instance-wide. All clients using the shared bearer token consume the
same daily budget; there is no client or user attribution. Counters and queues
live in one process, reset on restart, and are not coordinated across replicas.
Run one instance only. Multi-instance or restart-safe quota enforcement requires
a distributed atomic quota implementation that is outside v1.

The initial policy protects 20,000 of the 80,000 daily cost units as a safety
reserve. Each outbound operation reserves the worst case of three attempts (one
request plus two configured retries), even when fewer calls occur. This is
deliberately conservative because Steam does not publish a quota for every
approved source. Change these values only after reviewing live `observedCalls`,
retry behavior, and the per-source costs in
[the upstream register](./upstream-sources.md); preserve a nonzero reserve.

Startup validates numeric ceilings and cross-field invariants. In particular,
the safety reserve cannot exceed the global quota, operation concurrency cannot
exceed host concurrency, the default page size cannot exceed the maximum, and
the upstream timeout cannot exceed the execution deadline.

## Best-effort source switches

Each switch accepts only `true` or `false` and defaults to `true`:

- `STEAM_BEST_EFFORT_WISHLIST_ENABLED`
- `STEAM_BEST_EFFORT_STORE_SEARCH_ENABLED`
- `STEAM_BEST_EFFORT_STORE_DETAILS_ENABLED`
- `STEAM_BEST_EFFORT_DECK_COMPATIBILITY_ENABLED`
- `STEAM_BEST_EFFORT_GAME_REVIEWS_ENABLED`

Disable the narrowest affected source when its undocumented Steam contract
drifts. Disabling required store details also prevents successful
`steam_get_game` results.

## Connect a client

Configure the canonical MCP URL and fixed request header in the client:

```text
URL: https://mcp.example.com/mcp
Authorization: Bearer <MCP_ACCESS_TOKEN>
```

The endpoint accepts only `POST` at the exact configured URL and uses stateless
Streamable HTTP. It does not expose OAuth metadata or the deprecated HTTP+SSE
transport. A missing, malformed, or incorrect bearer header returns `401` with
`WWW-Authenticate: Bearer` before MCP or Steam work begins.

Remote cancellation is request-scoped: abort the original HTTP request. The
server does not correlate a later `notifications/cancelled` request because the
shared bearer token is not a safe client identity.

## Steam identity

The bearer token authorizes access to the whole instance. It does not identify a
client or Steam account and is never mapped to a Steam identity.

These player-oriented tools accept an optional `user` argument:

- `steam_get_player`
- `steam_get_library`
- `steam_get_recent_activity`
- `steam_get_achievements`
- `steam_get_friends`
- `steam_get_wishlist`

`user` accepts a SteamID64, vanity name, or allowlisted Steam Community profile
URL and may name any public Steam profile. An explicit `user` always overrides
the deployment's optional `STEAM_USER`. If neither is present, the tool returns
`IDENTITY_NOT_LINKED` without making a Steam request. The bearer token is never
used as a fallback. `steam_search_games` and `steam_get_game` do not require a
Steam user.

Steam privacy settings still apply. Authentication never grants access to
private Steam data.

## Token rotation

There is no account or token-management endpoint. To rotate access:

1. generate a new high-entropy token;
2. update the server secret and every approved client configuration;
3. restart the server;
4. verify the old token receives `401` and the new token can initialize MCP.

Because all clients share one secret, rotation invalidates every existing client
at once. If independent revocation, individual quotas, or user lifecycle is
required, v1 is not the right deployment model.

## Troubleshooting

### The server returns 401

Confirm the client sends exactly one `Authorization: Bearer <token>` header and
that its configured value matches `MCP_ACCESS_TOKEN`. Do not print either value
while comparing them. OAuth reconnect or discovery cannot fix this response.

### The server returns 403

Use the canonical URL rather than a proxy alias. Confirm the request `Host` is
in `ALLOWED_HOSTS` and any browser `Origin` is in `ALLOWED_ORIGINS`.

### The server returns 404 or 405

The MCP request must be `POST` to the exact `MCP_RESOURCE_URI`. Health checks
use `GET /livez` and `GET /readyz`.

### A player-oriented tool returns `IDENTITY_NOT_LINKED`

Pass `user` explicitly or ask the operator to configure the shared `STEAM_USER`
default. The shared bearer token is intentionally unrelated to Steam identity.

## Release boundary

Self-hosted HTTP v1 is approved only for a trusted operator and explicitly
authorized clients. Do not advertise a project-operated provider, hosted
account, public endpoint, or shared multi-tenant service. Before exposing an
instance, verify fixed-header support with the exact target client,
invalid-token rejection, Host/Origin policy, TLS, all eight tools, instance
quota behavior, sanitized diagnostics, graceful shutdown, and rollback.

See [ADR 0002](./adr/0002-static-bearer-authentication.md) for the decision and
[Operations](./operations.md) for the runbook.
