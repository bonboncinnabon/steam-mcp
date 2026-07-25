## ADDED Requirements

### Requirement: Safe hosted listener default

Self-hosted HTTP SHALL bind to loopback by default and SHALL require explicit
operator configuration to listen on all interfaces.

#### Scenario: Default listener

- **WHEN** hosted configuration omits `LISTEN_HOST`
- **THEN** the server binds to `127.0.0.1`

#### Scenario: Container listener

- **WHEN** the provided container starts
- **THEN** it explicitly configures `LISTEN_HOST=0.0.0.0`

### Requirement: Bounded inbound requests

The hosted Node HTTP bridge SHALL enforce configured request-body and receive
time limits before passing a request to the MCP transport.

#### Scenario: Declared oversized body

- **WHEN** a request declares a body larger than `maxRequestBytes`
- **THEN** the server rejects it with HTTP 413 without invoking MCP handling

#### Scenario: Streamed oversized body

- **WHEN** a request body exceeds `maxRequestBytes` while being received
- **THEN** the server stops reading it and returns HTTP 413 when the connection
  remains writable

#### Scenario: Slow request

- **WHEN** request headers or body are not received within the configured
  timeout
- **THEN** the server closes or rejects the request without invoking Steam work

### Requirement: Stable upstream failure semantics

Steam request deadlines and exhausted network failures SHALL remain typed
expected failures rather than becoming internal server errors.

#### Scenario: Steam deadline

- **WHEN** a Steam request exceeds its configured deadline
- **THEN** the tool reports `UPSTREAM_UNAVAILABLE` with retryable semantics

#### Scenario: Caller cancellation

- **WHEN** the calling MCP request is cancelled during Steam work
- **THEN** the work stops without retaining the caller's abort reason
- **AND** the failure does not expose request or credential data

### Requirement: Sanitized operational diagnostics

Hosted request, startup, readiness, and shutdown-cleanup failures SHALL remain
generic to remote callers while emitting a fixed sanitized failure category to
the operator.

#### Scenario: Handler failure

- **WHEN** the hosted request handler throws unexpectedly
- **THEN** the client receives a generic server error
- **AND** the operator receives a fixed request-failure diagnostic

#### Scenario: Cleanup failure

- **WHEN** an HTTP or quota resource fails during shutdown
- **THEN** shutdown remains bounded
- **AND** the operator receives a fixed cleanup-failure diagnostic
