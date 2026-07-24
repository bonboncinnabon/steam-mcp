# ADR 0002: Use one static bearer token for self-hosted HTTP

- Status: Accepted
- Date: 2026-07-22
- Supersedes: [ADR 0001](./0001-external-oauth-provider.md)

## Context

The v1 remote transport is an operator-controlled self-hosting option. The
project will not run a hosted identity provider, create user accounts, or offer
a public shared service. Adding OAuth would introduce account, provider, token,
discovery, and operational complexity that this deployment model does not need.

Remote access still requires a clear authentication boundary. The solution must
keep credentials out of MCP payloads and Steam requests, fail closed, and be
simple for one operator to configure and rotate.

## Decision

Self-hosted Streamable HTTP requires one high-entropy `MCP_ACCESS_TOKEN`
configured by the operator. Clients send the exact value in a fixed
`Authorization: Bearer <token>` header on every MCP request.

The server:

- requires at least 32 characters and a constrained secret-safe character set;
- compares token digests in constant time;
- returns a generic `401` and `WWW-Authenticate: Bearer` for missing, malformed,
  or incorrect credentials;
- strips the authorization header before MCP or Steam handling;
- exposes no OAuth discovery, login, signup, consent, refresh, or revocation
  endpoints;
- never maps the token to a Steam identity; and
- applies one instance-wide quota to all clients.

Clients must support configuring a fixed authorization header. OAuth-only
clients are not compatible with the v1 remote transport. Local stdio remains
available for clients that can launch a local process.

## Consequences

- Deployment has no external identity dependency and no account data.
- The operator owns token generation, secure distribution, storage, and
  rotation.
- Every approved client shares one credential. Rotation invalidates all clients
  at once, and individual clients cannot be revoked or attributed.
- The token cannot support per-user quotas, ownership, consent, or Steam account
  linking. Player-oriented tools use explicit `user` input or the optional
  operator-wide `STEAM_USER` default; the token is never an identity fallback.
- This model is appropriate only for private operator-controlled deployments.
  Public or multi-tenant service would require a new security design and ADR.
