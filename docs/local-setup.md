# Local setup

Local mode runs Steam MCP over stdio. The MCP client starts the server as a
child process and communicates through stdin and stdout; no local HTTP port is
opened.

## Requirements

- Node.js 22.22 or a current Node.js 24 release
- [pnpm](https://pnpm.io/installation)
- A [Steam Web API key](https://steamcommunity.com/dev/apikey) for the full tool
  set

Set these environment variables:

| Variable        | Required                                | Purpose                                                              |
| --------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `STEAM_API_KEY` | For player-oriented Steam Web API calls | Your Steam Web API credential                                        |
| `STEAM_USER`    | No                                      | Default SteamID64, vanity name, or HTTPS Steam Community profile URL |

Never commit the API key. If a client stores its MCP environment in a
configuration file, protect that file as a credential-bearing file.

## Run the packaged server

The package exposes the `steam-mcp` executable for local stdio. The separate
`steam-mcp-hosted` executable is for static-bearer-protected remote HTTP
deployments and does not change this local setup. `pnpm dlx` runs local stdio
without cloning this repository or adding it to another project's dependencies:

```sh
export STEAM_API_KEY="<your Steam Web API key>"
export STEAM_USER="<optional Steam user>"
pnpm dlx steam-mcp-server
```

The process intentionally waits for MCP messages on stdin. Starting it directly
does not display an interactive prompt.

For a version-pinned client configuration, replace `steam-mcp-server` in the
examples below with `steam-mcp-server@<version>`.

## Codex

Codex can register the stdio command from its CLI. The following passes the
values already held in your shell environment; the command itself does not
contain the resolved secret:

```sh
codex mcp add steam \
  --env STEAM_API_KEY="$STEAM_API_KEY" \
  --env STEAM_USER="$STEAM_USER" \
  -- pnpm dlx steam-mcp-server
```

Omit the `--env STEAM_USER=...` line when you do not want a default user.
Confirm the registration with:

```sh
codex mcp get steam
```

Codex persists values supplied with `--env` in its local MCP configuration. Use
the permissions appropriate for a file containing credentials, and remove the
registration with `codex mcp remove steam` if the machine should no longer
retain it.

## Claude Desktop

Open Claude Desktop's MCP configuration and add this server inside the existing
`mcpServers` object:

```json
{
  "mcpServers": {
    "steam": {
      "command": "pnpm",
      "args": ["dlx", "steam-mcp-server"],
      "env": {
        "STEAM_API_KEY": "<your Steam Web API key>",
        "STEAM_USER": "<optional Steam user>"
      }
    }
  }
}
```

Remove the `STEAM_USER` entry if it is not needed. Restart Claude Desktop after
saving the file. The configuration contains the API key, so do not share or
commit it.

## Generic stdio and OpenAI-compatible clients

For any MCP host that accepts the common stdio server descriptor, use:

```json
{
  "command": "pnpm",
  "args": ["dlx", "steam-mcp-server"],
  "env": {
    "STEAM_API_KEY": "<your Steam Web API key>",
    "STEAM_USER": "<optional Steam user>"
  }
}
```

Field names around this descriptor vary by client. For example, some clients
wrap it in `mcpServers`, while others ask for the command, arguments, and
environment separately. Remove `STEAM_USER` if you prefer to supply `user`
explicitly on every player-oriented call.

Remote API integrations connect to MCP URLs, not a process on your computer. Use
this stdio configuration with a local MCP host such as Codex. Use the
self-hosted HTTP setup only when the remote client can attach a fixed
`Authorization` bearer header.

## MCP Inspector

To inspect the published package without cloning the repository, export the
environment variables and launch the Inspector CLI:

```sh
export STEAM_API_KEY="<your Steam Web API key>"
export STEAM_USER="<optional Steam user>"
pnpm dlx @modelcontextprotocol/inspector --cli \
  pnpm dlx steam-mcp-server \
  --method tools/list
```

The result must list exactly these tools:

1. `steam_get_player`
2. `steam_get_library`
3. `steam_get_recent_activity`
4. `steam_get_achievements`
5. `steam_get_friends`
6. `steam_get_wishlist`
7. `steam_search_games`
8. `steam_get_game`

The Inspector can also start its browser interface when `--cli` and the method
arguments are omitted:

```sh
pnpm dlx @modelcontextprotocol/inspector pnpm dlx steam-mcp-server
```

## Develop from source

Use pnpm for every project command:

```sh
git clone <repository URL>
cd steam-mcp
pnpm install --frozen-lockfile
pnpm build
```

In a client configuration, replace the packaged command with Node.js and an
absolute path to the built entry point:

```json
{
  "command": "node",
  "args": ["<absolute path to steam-mcp>/dist/bin/steam-mcp.js"],
  "env": {
    "STEAM_API_KEY": "<your Steam Web API key>",
    "STEAM_USER": "<optional Steam user>"
  }
}
```

Run the focused local conformance check with:

```sh
pnpm test:inspector
```

Run the complete repository verification with:

```sh
pnpm check
```

## Troubleshooting

- `STEAM_AUTH_FAILED`: configure `STEAM_API_KEY`; the server deliberately does
  not print the rejected credential.
- `IDENTITY_NOT_LINKED`: add `user` to the tool call or configure `STEAM_USER`
  locally.
- Private or missing data: verify the Steam profile, game details, friend list,
  or game-details visibility in Steam. The MCP server cannot bypass Steam
  privacy settings.
- Client starts and immediately exits: inspect the client's MCP logs. Startup
  diagnostics go to stderr so stdout remains valid MCP traffic.
- `pnpm` not found from a desktop app: configure the client with the absolute
  path returned by `command -v pnpm`.
