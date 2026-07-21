# ADR 0001: Use WorkOS AuthKit as the hosted authorization server

- Status: Accepted
- Date: 2026-07-22

## Context

The hosted Steam MCP needs browser-based OAuth without becoming an identity or
account-management product. The server is an OAuth 2.1 resource server only. It
must interoperate with current MCP clients while keeping authentication,
consent, token issuance, revocation, and account deletion outside this
repository.

The current MCP authorization specification requires Protected Resource Metadata
and resource-bound access tokens. It recommends Client ID Metadata Documents
(CIMD), retains Dynamic Client Registration (DCR) as a fallback, and requires
clients to use PKCE S256 and the `resource` parameter. See the
[MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

## Decision

Use [WorkOS AuthKit](https://workos.com/docs/authkit/mcp) as the default hosted
OAuth/OIDC authorization server.

The deployment will:

- enable CIMD for current clients and DCR for backward compatibility;
- configure the canonical MCP HTTPS URI as an allowed Resource Indicator;
- require authorization-code flow with PKCE S256;
- configure only the minimum hosted MCP scope, initially `steam:read`;
- validate JWT signature, algorithm, issuer, audience, expiry, not-before time,
  subject, and scope against AuthKit's rotating JWKS;
- use AuthKit token introspection when current token status is required;
- use short-lived access tokens and provider-managed refresh-token rotation;
- never pass an MCP token to Steam or infer a Steam identity from its subject.

The MCP server will host RFC 9728 Protected Resource Metadata and return its URL
in unauthenticated `WWW-Authenticate` challenges. AuthKit remains the source of
truth for authorization-server metadata, login, consent, token issuance,
revocation, and the complete user-account lifecycle. This repository will not
expose account creation, linking, unlinking, or deletion tools or endpoints.

WorkOS must be configured explicitly: CIMD and DCR are off by default, and the
Resource Indicator must match the canonical resource URI exactly. Without that
indicator, AuthKit documents that it uses its environment audience instead of
the MCP resource. AuthKit publishes S256 support, authorization and token
endpoints, a registration endpoint, and an introspection endpoint in its
authorization-server metadata. See the
[AuthKit MCP guide](https://workos.com/docs/authkit/mcp) and
[token introspection reference](https://workos.com/docs/reference/workos-connect/introspection).

## Provider evaluation

| Criterion                | WorkOS AuthKit                                                        | Descope                                                | Auth0                                                                                |
| ------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| MCP-specific integration | Direct guide with PRM, challenge, audience, and verification examples | Direct MCP guide and agent-oriented controls           | Direct Auth for MCP product and guides                                               |
| PKCE S256                | Advertised in authorization-server metadata                           | Supported                                              | Supported for public/DCR clients                                                     |
| Resource Indicators      | Explicit allowlist; requested resource becomes `aud`                  | MCP server URL is the audience                         | Requires Resource Parameter Compatibility Profile configuration                      |
| Client registration      | CIMD preferred; DCR fallback                                          | CIMD, DCR, or preregistration                          | CIMD and DCR, with more tenant-specific configuration                                |
| Current token status     | Authenticated introspection endpoint                                  | Revocation and provider checks available               | JWT access tokens generally remain valid until expiry; refresh grants can be revoked |
| Operational fit          | Smallest MCP-specific integration surface                             | Strong alternative, especially for richer agent policy | Mature general IAM, but more setup than this server needs                            |

[Descope](https://docs.descope.com/mcp) is the preferred fallback if WorkOS is
unavailable or its commercial terms are unsuitable. Auth0 remains viable, but
its MCP path requires additional tenant configuration documented in
[Auth0 Auth for MCP](https://auth0.com/ai/docs/mcp/intro/overview).

## Client compatibility

| Client                               | Registration and authorization expectation                                                                                                     | Release evidence required                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| ChatGPT apps                         | CIMD is preferred; DCR and pre-registered clients remain supported. Public clients use `none`; confidential clients may use `private_key_jwt`. | Connect through the ChatGPT app flow and complete OAuth, initialization, tool listing, and one tool call. |
| Codex                                | Remote Streamable HTTP OAuth discovery/login.                                                                                                  | Connect the hosted URL, complete login, list tools, and call one tool.                                    |
| Claude custom connectors             | OAuth discovery with DCR or explicitly supplied client credentials.                                                                            | Add the connector URL, complete login, list tools, and call one tool.                                     |
| OpenAI Responses API                 | The calling application obtains and supplies the access token.                                                                                 | Call the remote MCP tool with a valid bearer token and verify an invalid token is rejected.               |
| Anthropic Messages API MCP connector | The calling application obtains and supplies the access token.                                                                                 | Call the connector with a valid bearer token and verify an invalid token is rejected.                     |

OpenAI explicitly recommends CIMD when supported and documents ChatGPT support
for CIMD and DCR in its
[remote MCP authentication guidance](https://developers.openai.com/api/docs/mcp#handle-authentication).
Claude also permits a custom connector to be configured with an OAuth client ID
and secret when automatic registration is not available; see
[Anthropic's remote MCP connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

Standards alignment is not treated as proof of product compatibility. A hosted
release still requires the live client checks above against the exact provider
tenant and deployment configuration.

## Consequences

- The application owns no password, consent, refresh token, account, or account
  deletion data.
- The resource server still owns authorization enforcement and must fail closed
  when signature validation, JWKS retrieval, or required status checks fail.
- Provider replacement remains possible because provider-specific behavior is
  isolated behind authorization ports and standard discovery/JWT contracts.
- Hosted operation depends on WorkOS availability for new authorization flows
  and token-status checks. Existing locally verifiable tokens remain subject to
  their configured expiry and the server's status-check policy.
- DCR is exposed only for MCP interoperability and must be monitored for abusive
  client creation. CIMD is the preferred path.
