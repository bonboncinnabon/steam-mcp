## ADDED Requirements

### Requirement: Local stdio transport

The system SHALL expose the same eight tool contracts through an MCP `stdio`
entry point for local and self-hosted use.

#### Scenario: Local MCP initialization

- **WHEN** an MCP client starts the packaged local command with valid
  environment configuration
- **THEN** the process negotiates MCP over stdin and stdout and lists the same
  eight tools as hosted mode

### Requirement: Environment-based local configuration

Local mode SHALL read the Steam API credential from `STEAM_API_KEY` and the
optional default Steam identity from `STEAM_USER`.

#### Scenario: Local default identity

- **WHEN** a local subject-oriented tool omits `user` and `STEAM_USER` is valid
- **THEN** the tool resolves the request using that configured identity

#### Scenario: Missing required Steam key

- **WHEN** a local tool requiring a Steam API key is invoked without
  `STEAM_API_KEY`
- **THEN** the tool returns `STEAM_AUTH_FAILED` with setup guidance and does not
  call Steam

### Requirement: Stdio stream purity

The local process MUST write only valid MCP protocol messages to stdout and MUST
send redacted diagnostics to stderr.

#### Scenario: Local startup diagnostic

- **WHEN** local mode emits an informational or error diagnostic
- **THEN** the diagnostic appears on stderr and cannot corrupt the MCP stdout
  stream

### Requirement: Local and remote contract parity

Local and remote transports SHALL use the same domain services, tool schemas,
result envelopes, error codes, and source-tier behavior. Transport-specific
defaulting is limited to local `STEAM_USER`; remote callers supply explicit
users to subject-oriented tools.

#### Scenario: Equivalent explicit-user call

- **WHEN** the same explicit public-user tool call is executed locally and
  remotely under equivalent upstream fixtures
- **THEN** both transports return equivalent structured tool data and metadata

### Requirement: Local data minimization

Local mode SHALL NOT require hosted authorization, quota dependencies, account
persistence, or unused placeholder infrastructure. Any process-local state added
for a consumed port SHALL be bounded and SHALL NOT persist Steam payloads to
disk.

#### Scenario: Local process exits

- **WHEN** the local MCP process terminates
- **THEN** any process-local state is discarded without writing user Steam
  payloads to disk

### Requirement: Packaged local execution

The project SHALL provide a reproducible package command and documented client
configuration for supported local MCP clients.

#### Scenario: Clean local setup verification

- **WHEN** a user follows the documented package configuration in a clean
  supported environment
- **THEN** the MCP client starts the server without cloning the repository and
  can execute a public Steam tool
