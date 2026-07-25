## ADDED Requirements

### Requirement: One scoped public package

The project SHALL publish one public npm package named `@abiswas97/steam-mcp`,
and that package SHALL expose only the `steam-mcp` executable.

#### Scenario: Package metadata

- **WHEN** the release tarball is inspected
- **THEN** its public package name is `@abiswas97/steam-mcp`
- **AND** its only executable is `steam-mcp`

### Requirement: Explicit transport selection

The `steam-mcp` executable SHALL start stdio when invoked without arguments and
SHALL start self-hosted Streamable HTTP when invoked with the `serve`
subcommand.

#### Scenario: Default execution

- **WHEN** an MCP client launches `steam-mcp` with no positional arguments
- **THEN** the process communicates only through MCP stdio

#### Scenario: HTTP execution

- **WHEN** an operator launches `steam-mcp serve` with valid hosted
  configuration
- **THEN** the process starts the configured Streamable HTTP listener

#### Scenario: Unsupported execution mode

- **WHEN** `steam-mcp` receives an unsupported positional argument
- **THEN** it exits non-zero with a concise usage message on stderr

### Requirement: Installable artifact verification

The release process SHALL verify the packed artifact as a clean consumer before
publishing it.

#### Scenario: Clean consumer verification

- **WHEN** the release tarball is installed into an empty pnpm consumer project
- **THEN** both the default stdio mode and the `serve` mode are exercised
  through the single packaged executable

### Requirement: Registry publication ordering

The release process SHALL verify build and test gates before registry
publication and SHALL create the public GitHub Release only after npm and
container publication are verified.

#### Scenario: Successful release

- **WHEN** a protected version tag completes every release gate
- **THEN** npm contains the exact scoped version
- **AND** GHCR contains an immutable image digest
- **AND** the GitHub Release is created last with checksummed evidence

#### Scenario: Failed release gate

- **WHEN** any verification or publication gate fails
- **THEN** the workflow does not create a new public GitHub Release
