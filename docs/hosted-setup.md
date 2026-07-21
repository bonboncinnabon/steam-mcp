# Hosted Steam MCP setup

The hosted service is a read-only OAuth-protected MCP resource server. Users
authorize the MCP client in a browser and do not supply a Steam Web API key. The
deployment supplies its own Steam credential.

This repository does not currently publish a hosted service. In the examples
below, replace `https://mcp.example.com/mcp` with the exact canonical HTTPS MCP
resource URL supplied by the operator. Do not append a path or trailing slash
unless it is part of that configured URL.

## Connect a remote MCP client

Add the canonical resource URL as a remote Streamable HTTP MCP server in the
client:

```text
https://mcp.example.com/mcp
```

The client should discover the protected resource, open the external provider's
authorization flow, and return after consent. The initial hosted scope is
`steam:read`. The endpoint does not support the deprecated HTTP-plus-SSE
transport.

Clients that manage OAuth themselves can discover the resource metadata at the
RFC 9728 URL derived from the MCP path. For the example above, it is:

```text
https://mcp.example.com/.well-known/oauth-protected-resource/mcp
```

The metadata identifies:

- the canonical MCP resource URI;
- the external authorization server;
- the supported scope; and
- bearer-token transport in the `Authorization` header.

An unauthenticated request to the MCP endpoint returns a `WWW-Authenticate`
challenge pointing to the same metadata document. Access tokens must be issued
for the exact canonical resource URI. A token for another audience is rejected.
Never place an access token in a URL, tool argument, or client log.

## Steam users are explicit in hosted mode

OAuth authorizes access to this MCP server. It does not identify a Steam account
and is never interpreted as a Steam user.

The six subject-oriented tools therefore require a `user` argument in hosted
mode:

- `steam_get_player`
- `steam_get_library`
- `steam_get_recent_activity`
- `steam_get_achievements`
- `steam_get_friends`
- `steam_get_wishlist`

`user` accepts a SteamID64 string, a Steam vanity name, or an allowlisted Steam
Community profile URL. It may name any public Steam profile, not only a profile
owned by the person who completed OAuth. Omitting it returns
`IDENTITY_NOT_LINKED` and performs no Steam request. Hosted mode deliberately
has no `STEAM_USER` default and stores no OAuth-to-Steam account link.

The game-oriented `steam_search_games` and `steam_get_game` tools do not require
a Steam user.

All results remain subject to the selected Steam profile's privacy settings.
Authorization does not reveal private Steam data. For example, a private game
library returns `PROFILE_PRIVATE` rather than being represented as an empty
library.

## Account ownership and revocation

[WorkOS AuthKit](https://workos.com/docs/authkit/mcp) is the default external
OAuth provider. The provider owns signup, login, consent, sessions, token
issuance, revocation, and account deletion. Follow the operator's link to the
provider's account or authorization settings to revoke access or delete the
provider account.

The MCP server has no account creation, Steam linking, unlinking, mutation, or
deletion endpoint or tool. Deleting a provider account does not delete or modify
the referenced Steam profile. The resource server validates token status and
rejects expired, invalid, or revoked access.

## Quotas and availability

Hosted calls share a service-owned Steam API allowance. The service applies both
per-OAuth-subject and global daily cost budgets, retains a safety reserve, and
limits concurrent Steam work. A composite tool can cost more than a single
upstream call.

The operator may change quota values, so clients must not depend on a fixed
number of calls. `USER_QUOTA_EXCEEDED` means the caller's current allowance is
exhausted. A global reserve or a saturated concurrency queue can temporarily
make Steam work unavailable. Retry only when the structured error marks the
failure as retryable, and respect any retry guidance returned by the service.

The initial quota implementation is bounded and process-local. Operators must
use a distributed atomic quota implementation before running multiple service
instances or beginning a broad public rollout. Restarting a single instance can
reset its process-local counters; this is an operational limitation, not a
quota-bypass contract.

## Privacy and retention

The hosted MCP is stateless with respect to user accounts and Steam data. It
does not durably store OAuth subjects, Steam identities, Steam responses,
prompts, or tool arguments. It has no response cache or request coalescer in v1.
Quota accounting uses opaque subject-derived keys and bounded counters with
rollover metadata.

The service does not promise anonymity from Steam: its service-owned credential
and network address are used for outbound requests. Steam receives the public
Steam identifier and app identifiers needed to answer the request. The service
cannot expose fields that Steam marks private, and selected best-effort
Steam-operated sources can be temporarily unavailable or disabled if their
contracts change.

## Troubleshooting

### The client does not open an OAuth login

Confirm that the configured URL is the canonical HTTPS MCP resource URL, not the
metadata URL or authorization-server URL. Fetch the protected-resource metadata
directly and verify that its `resource` value exactly matches the MCP URL. If
metadata is unavailable, contact the hosted operator.

### The server returns 401

Reconnect the client so it can obtain a current token. A missing, expired,
revoked, incorrectly signed, or wrong-audience token is rejected before MCP or
Steam work begins. If reconnecting does not help, verify that the OAuth client
requested the resource URI reported by protected-resource metadata.

### The server returns 403

A token may lack `steam:read`, or the deployment may reject the request's `Host`
or browser `Origin`. Use the public canonical URL rather than a proxy alias.
Operators must add intended hosts and browser origins to the deployment
allowlists instead of trusting forwarded-host headers.

### A player tool returns `IDENTITY_NOT_LINKED`

Pass `user` explicitly. Hosted OAuth accounts are intentionally not linked to
Steam accounts.

### A tool returns `PROFILE_PRIVATE`

The requested field is not public on Steam. Change the Steam profile's privacy
settings in Steam, choose another public profile, or use a tool that does not
need that private field. OAuth cannot override Steam privacy.

### A tool returns `BEST_EFFORT_SOURCE_CHANGED`

An optional Steam-operated source no longer matched its validated contract.
Retry later or omit the affected optional facet. Supported data may still be
returned with `meta.partial: true` and a warning when safe composition is
possible.

### A tool returns `USER_QUOTA_EXCEEDED` or is temporarily unavailable

Reduce repeated and high-fan-out calls. Retry only when the structured error
permits it. The operator can confirm current quota policy, global capacity, and
service readiness without inspecting Steam payloads or tool arguments.

## Operator boundary

A self-hosted remote deployment must configure an HTTPS canonical MCP resource,
the external OAuth issuer, a deployment-owned `STEAM_API_KEY`, strict Host and
Origin allowlists, quota policy, and secret management. WorkOS must be
configured with the canonical URL as an allowed Resource Indicator and with the
client-registration modes required by supported MCP clients. See
[ADR 0001](./adr/0001-external-oauth-provider.md) for the provider decision and
release compatibility requirements.

Publishing a URL is not sufficient release evidence. Verify OAuth discovery,
audience binding, initialization, tool listing, one successful public-data call,
structured errors, quotas, cancellation, and shutdown against every supported
client before announcing the deployment.
