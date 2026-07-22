# Changelog

All notable changes to this project will be documented in this file.

The project follows Semantic Versioning. It has not published a stable release;
the current repository state remains unreleased and may not correspond to a
deployed public service.

## Unreleased

### Added

- Initial read-only Steam MCP implementation with eight curated tools.
- Shared application behavior for local stdio and stateless self-hosted
  Streamable HTTP transports.
- Static bearer authentication, Host and Origin enforcement, bounded
  instance-wide in-memory quota and concurrency controls, health checks,
  graceful shutdown, and redacted observability for self-hosted HTTP
  deployments.
- Scrubbed contract fixtures, opt-in live probes, conformance tests, coverage
  gates, and targeted high-risk mutation and fault-injection tests.

### Security

- Steam credentials, MCP bearer tokens, raw upstream bodies, prompts, tool
  inputs, and account identifiers are excluded from durable application state
  and operational telemetry.
- The MCP surface provides no Steam mutation or account-management operation.
- The project provides no hosted provider, user account, public shared endpoint,
  or bearer-token-to-Steam identity mapping.
