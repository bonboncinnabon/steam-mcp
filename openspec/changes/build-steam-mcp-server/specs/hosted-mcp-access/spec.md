## ADDED Requirements

### Requirement: Hosted Streamable HTTP endpoint

The system SHALL expose the complete read-only Steam MCP tool surface through
one standards-compliant Streamable HTTP endpoint on a canonical HTTPS resource
URI.

#### Scenario: Authenticated MCP initialization

- **WHEN** a client sends a valid MCP initialization request with an accepted
  access token
- **THEN** the system completes protocol negotiation and exposes the eight
  approved tools

#### Scenario: Unsupported legacy transport

- **WHEN** a client attempts to connect through the deprecated HTTP plus SSE
  transport
- **THEN** the system rejects that transport without creating a parallel legacy
  endpoint

### Requirement: OAuth protected-resource discovery

The system SHALL implement OAuth Protected Resource Metadata and SHALL identify
the external authorization server and canonical MCP resource URI.

#### Scenario: Unauthenticated MCP request

- **WHEN** a client requests the protected MCP endpoint without an access token
- **THEN** the system returns HTTP 401 with a `WWW-Authenticate` challenge that
  identifies the protected-resource metadata URL

#### Scenario: Metadata discovery

- **WHEN** a client requests the protected-resource metadata document
- **THEN** the system returns the canonical resource URI, authorization-server
  location, and supported MCP scopes

### Requirement: Access-token validation

The system MUST validate token signature, issuer, audience, expiry, required
scope, and revocation or current token status before processing a hosted MCP
request.

#### Scenario: Valid audience-bound token

- **WHEN** a client presents an unexpired, correctly signed token issued for the
  canonical MCP resource with the required scope
- **THEN** the system authorizes the request for that token subject

#### Scenario: Token for another resource

- **WHEN** a client presents an otherwise valid token whose audience does not
  include the canonical MCP resource
- **THEN** the system rejects the request without invoking a tool or Steam
  upstream

#### Scenario: Expired or revoked token

- **WHEN** a client presents an expired or revoked token
- **THEN** the system rejects the request and performs no application work

### Requirement: No OAuth token passthrough

The system MUST use MCP access tokens only to authorize this resource server and
MUST NOT forward them to Steam or any other upstream system.

#### Scenario: Authorized Steam tool call

- **WHEN** an authorized hosted tool call requires Steam data
- **THEN** the outbound request uses only the service-owned Steam credential
  required for that operation and excludes the MCP access token

### Requirement: Hosted access requires no user Steam API key

The system SHALL allow an ordinary hosted user to use all eligible tools without
supplying or storing a personal Steam API key.

#### Scenario: First hosted tool call

- **WHEN** an authorized user with no personal Steam API key invokes a tool
  against public data
- **THEN** the system executes the call using the hosted service credential and
  applicable quota policy

### Requirement: Origin and Host enforcement

The system MUST validate HTTP Origin and Host values for hosted MCP traffic
according to the deployed allowlists.

#### Scenario: Disallowed Origin

- **WHEN** a request includes an Origin outside the configured allowlist
- **THEN** the system returns HTTP 403 before parsing or executing an MCP tool
  call

#### Scenario: Disallowed Host

- **WHEN** a request targets an unrecognized Host value
- **THEN** the system rejects the request before authorization or tool execution

### Requirement: Independent health endpoints

The system SHALL expose separate liveness and readiness endpoints that do not
call Steam.

#### Scenario: Live process with unavailable Steam API

- **WHEN** the process is healthy but Steam is unavailable
- **THEN** the liveness endpoint reports healthy without issuing an upstream
  request

#### Scenario: Required hosted dependency unavailable

- **WHEN** a required hosted storage or authorization dependency is unavailable
- **THEN** the readiness endpoint reports not ready while liveness remains based
  on process health

### Requirement: Supported-client compatibility

The hosted endpoint SHALL be verified against MCP Inspector and the documented
remote MCP connection paths for supported Codex, Claude, and OpenAI clients
before release.

#### Scenario: Release candidate compatibility run

- **WHEN** a hosted release candidate is prepared
- **THEN** the compatibility suite verifies initialization, discovery,
  authorization, tool listing, tool execution, structured results, and errors on
  each supported client path
