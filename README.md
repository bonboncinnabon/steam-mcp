# Steam MCP Server

A remote-first, read-only
[Model Context Protocol](https://modelcontextprotocol.io/) server for clean
access to public Steam data. It exposes eight focused tools and supports both
hosted Streamable HTTP and local stdio clients.

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
running the OAuth-protected Streamable HTTP server. This repository does not
publish a public hosted URL, and hosted client or staging compatibility has not
yet been verified.

After configuring the required Steam, OAuth, resource, and Host environment
variables plus any desired optional capacity settings, run the packaged
executable:

```sh
pnpm dlx --package steam-mcp-server steam-mcp-hosted
```

The executable listens on plain HTTP (`0.0.0.0:3000` by default). Production
deployments must terminate TLS at a trusted reverse proxy and expose the exact
HTTPS `MCP_RESOURCE_URI`. The initial quota and concurrency implementations are
process-local, so run exactly one instance until a distributed atomic quota
adapter exists.

See [Hosted setup](docs/hosted-setup.md) for every environment variable and
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
- Local mode does not require hosted authorization, account linking, or
  persistent storage.
- Hosted mode is only an OAuth resource server. It has no MCP account creation,
  Steam linking or unlinking, token revocation, or account deletion lifecycle.
- Local process state is discarded when the server exits.

## License

[MIT](LICENSE)
