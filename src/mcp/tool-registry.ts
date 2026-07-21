import type {
  McpServer,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";

import { STEAM_TOOL_CONTRACTS } from "./tool-contracts.js";

type SteamToolContracts = typeof STEAM_TOOL_CONTRACTS;
export type SteamToolName = keyof SteamToolContracts;

export type SteamToolBindings = {
  readonly [Name in SteamToolName]: ToolCallback<
    SteamToolContracts[Name]["inputSchema"]
  >;
};

export function registerSteamTools(
  server: McpServer,
  bindings: SteamToolBindings,
): void {
  server.registerTool(
    "steam_get_player",
    STEAM_TOOL_CONTRACTS.steam_get_player,
    bindings.steam_get_player,
  );
  server.registerTool(
    "steam_get_library",
    STEAM_TOOL_CONTRACTS.steam_get_library,
    bindings.steam_get_library,
  );
  server.registerTool(
    "steam_get_recent_activity",
    STEAM_TOOL_CONTRACTS.steam_get_recent_activity,
    bindings.steam_get_recent_activity,
  );
  server.registerTool(
    "steam_get_achievements",
    STEAM_TOOL_CONTRACTS.steam_get_achievements,
    bindings.steam_get_achievements,
  );
  server.registerTool(
    "steam_get_friends",
    STEAM_TOOL_CONTRACTS.steam_get_friends,
    bindings.steam_get_friends,
  );
  server.registerTool(
    "steam_get_wishlist",
    STEAM_TOOL_CONTRACTS.steam_get_wishlist,
    bindings.steam_get_wishlist,
  );
  server.registerTool(
    "steam_search_games",
    STEAM_TOOL_CONTRACTS.steam_search_games,
    bindings.steam_search_games,
  );
  server.registerTool(
    "steam_get_game",
    STEAM_TOOL_CONTRACTS.steam_get_game,
    bindings.steam_get_game,
  );
}
