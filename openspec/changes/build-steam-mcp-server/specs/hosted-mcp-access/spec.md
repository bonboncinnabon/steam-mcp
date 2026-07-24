## ADDED Requirements

### Requirement: Self-hosted Streamable HTTP endpoint

The system SHALL expose the complete read-only Steam MCP tool surface through
one Streamable HTTP endpoint on a canonical HTTPS URI for operator-controlled
self-hosting.

#### Scenario: Authorized MCP initialization

- **WHEN** a client sends a valid MCP initialization request with the exact
  configured bearer token
- **THEN** the system completes protocol negotiation and exposes the eight
  approved tools

#### Scenario: Unsupported legacy transport

- **WHEN** a client attempts to connect through the deprecated HTTP plus SSE
  transport
- **THEN** the system rejects that transport without creating a parallel legacy
  endpoint

### Requirement: Static bearer protection

The remote endpoint MUST require one high-entropy bearer token supplied through
deployment configuration and MUST compare presented credentials in constant
time.

#### Scenario: Missing or malformed credential

- **WHEN** a remote MCP request omits the Authorization header or uses a scheme
  other than exactly one bearer credential
- **THEN** the system returns HTTP 401 with a generic `WWW-Authenticate: Bearer`
  challenge before MCP parsing, quota reservation, or Steam work

#### Scenario: Incorrect credential

- **WHEN** a remote MCP request presents a bearer token other than the
  configured token
- **THEN** the system returns the same generic HTTP 401 response without
  revealing comparison details or performing application work

#### Scenario: Token rotation

- **WHEN** an operator replaces the configured bearer token and restarts the
  process
- **THEN** the previous token stops authorizing requests and the replacement
  token becomes the sole accepted credential

### Requirement: Bearer and Steam credential isolation

The system MUST use the bearer token only to protect the remote MCP endpoint and
MUST NOT forward it to Steam, expose it to tools, treat it as a Steam identity,
or include it in logs, metrics, errors, or persisted state.

#### Scenario: Authorized Steam tool call

- **WHEN** an authorized remote tool call requires Steam data
- **THEN** the outbound request uses only the operator-provided Steam credential
  required for that operation and excludes the bearer token

### Requirement: Remote access requires no caller Steam API key

The system SHALL allow an authorized remote caller to use eligible tools without
supplying a Steam API key because the self-hosting operator configures it at
deployment time.

#### Scenario: First remote tool call

- **WHEN** an authorized caller invokes a tool against public data
- **THEN** the system executes the call using the operator's Steam credential
  and configured instance quota policy

### Requirement: Optional operator default Steam user

The private remote instance SHALL accept `STEAM_USER` as an optional
operator-configured public lookup default. This value MUST NOT be derived from
the bearer token, mutated through MCP, or represented as caller-specific
identity.

#### Scenario: Hosted default user

- **WHEN** an authorized subject-oriented call omits `user` and the operator
  configured `STEAM_USER`
- **THEN** the system uses that shared default while performing no identity
  persistence

#### Scenario: Explicit hosted user

- **WHEN** an authorized subject-oriented call supplies `user`
- **THEN** the explicit public user takes precedence over `STEAM_USER`

### Requirement: Origin and Host enforcement

The system MUST validate HTTP Origin and Host values for remote MCP traffic
according to the deployed allowlists.

#### Scenario: Disallowed Origin

- **WHEN** a request includes an Origin outside the configured allowlist
- **THEN** the system returns HTTP 403 before parsing or executing an MCP tool
  call

#### Scenario: Disallowed Host

- **WHEN** a request targets an unrecognized Host value
- **THEN** the system rejects the request before bearer validation or tool
  execution

### Requirement: Independent health endpoints

The system SHALL expose separate liveness and readiness endpoints that do not
call Steam and do not disclose configured secrets.

#### Scenario: Live process with unavailable Steam API

- **WHEN** the process is healthy but Steam is unavailable
- **THEN** the liveness endpoint reports healthy without issuing an upstream
  request

#### Scenario: Invalid required remote configuration

- **WHEN** the bearer token, Steam credential, canonical URI, or
  request-boundary configuration is invalid
- **THEN** startup fails before either health or MCP traffic is accepted

### Requirement: Supported-client compatibility

The remote endpoint SHALL be verified against MCP Inspector and documented MCP
client paths that can configure a fixed Authorization bearer header. Clients
that require browser OAuth SHALL be documented as unsupported for remote v1.

#### Scenario: Release candidate compatibility run

- **WHEN** a remote release candidate is prepared
- **THEN** the compatibility suite verifies initialization, bearer rejection and
  acceptance, tool listing, tool execution, structured results, errors, and
  request-abort cancellation on each supported client path
