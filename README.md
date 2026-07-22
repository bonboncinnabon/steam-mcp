# Steam MCP Server

A self-hostable, read-only
[Model Context Protocol](https://modelcontextprotocol.io/) server for clean
access to public Steam data. It exposes eight focused tools and supports both
self-hosted Streamable HTTP and local stdio clients.

The server does not modify Steam accounts, manage account settings, delete
accounts, or provide recommendation and player-analysis tools.

## Tools

| Tool                        | Public Steam data returned                                             |
| --------------------------- | ---------------------------------------------------------------------- |
| `steam_get_player`          | Profile, visibility, presence, current game, and ban-summary facts     |
| `steam_get_library`         | Filtered, sorted, cursor-paginated game library and recorded playtime  |
| `steam_get_recent_activity` | Recently played games and available current activity                   |
| `steam_get_achievements`    | Cursor-paginated achievement progress for one player and app           |
| `steam_get_friends`         | Cursor-paginated friends with optional bounded profile enrichment      |
| `steam_get_wishlist`        | Cursor-paginated wishlist with availability, price, and discount facts |
| `steam_search_games`        | Bounded Steam game candidates with stable app IDs                      |
| `steam_get_game`            | Store details and explicitly requested optional game facets            |

Steam privacy settings still apply. Private or unavailable data is reported as
unavailable rather than bypassed.

## Local quick start

Requirements:

- Node.js 22.22 or a current Node.js 24 release
- [pnpm](https://pnpm.io/installation)
- A [Steam Web API key](https://steamcommunity.com/dev/apikey) for the full tool
  set

Export your credential in the environment, then start the package executable:

```sh
export STEAM_API_KEY="<your Steam Web API key>"
export STEAM_USER="<optional SteamID64, vanity name, or profile URL>"
pnpm dlx steam-mcp-server
```

`STEAM_USER` is optional. It supplies a local default for the six
player-oriented tools; an explicit `user` tool argument always takes precedence.
Game search and exact game lookup do not require a user.

For Codex, Claude Desktop, generic stdio clients, MCP Inspector, and
development-from-source instructions, see [Local setup](docs/local-setup.md).

## Self-hosted HTTP quick start

The package also exposes `steam-mcp-hosted`, a portable Node.js executable for
running a Streamable HTTP server protected by one operator-configured bearer
token. This repository does not operate a hosted provider, user-account system,
or public shared service.

Generate a high-entropy token, configure the required Steam, token, resource,
and Host environment variables, then run the packaged executable:

```sh
export STEAM_API_KEY="<deployment Steam Web API key>"
export MCP_ACCESS_TOKEN="<random secret of at least 32 characters>"
export MCP_RESOURCE_URI="https://mcp.example.com/mcp"
export ALLOWED_HOSTS="mcp.example.com"
pnpm dlx --package steam-mcp-server steam-mcp-hosted
```

The executable listens on plain HTTP (`0.0.0.0:3000` by default). Production
deployments must terminate TLS at a trusted reverse proxy and expose the exact
HTTPS `MCP_RESOURCE_URI`. The initial quota and concurrency implementations are
process-local, so run exactly one instance until a distributed atomic quota
adapter exists.

Remote clients must support configuring a fixed `Authorization: Bearer <token>`
header. OAuth discovery and interactive login are not part of v1. See
[Hosted setup](docs/hosted-setup.md) for every environment variable and
[Operations](docs/operations.md) for TLS, health, draining, and rollout gates.

## Development

This repository uses pnpm exclusively:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test:inspector
```

Additional test commands are documented in [Testing](docs/testing.md).

## Security and data boundaries

- All eight tools are read-only.
- Local credentials are read from process environment or the MCP client's local
  configuration.
- The server never logs the Steam API key.
- Local mode does not require remote authorization, account linking, or
  persistent storage.
- Self-hosted HTTP mode compares each bearer credential with one
  operator-configured secret. It has no users, accounts, OAuth flow, or
  token-to-Steam identity mapping.
- Remote quota and concurrency limits apply to the whole running instance, not
  to individual clients.
- Local process state is discarded when the server exits.

## License

[MIT](LICENSE)
