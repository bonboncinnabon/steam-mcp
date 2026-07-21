import type {
  McpServer,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";

import { STEAM_TOOL_CONTRACTS } from "./tool-contracts.js";
import type { createSteamToolContracts } from "./tool-contracts.js";

type SteamToolContracts = ReturnType<typeof createSteamToolContracts>;
export type SteamToolName = keyof SteamToolContracts;

export type SteamToolBindings = {
  readonly [Name in SteamToolName]: ToolCallback<
    SteamToolContracts[Name]["inputSchema"]
  >;
};

export function registerSteamTools(
  server: McpServer,
  bindings: SteamToolBindings,
  contracts: SteamToolContracts = STEAM_TOOL_CONTRACTS,
): void {
  server.registerTool(
    "steam_get_player",
    contracts.steam_get_player,
    bindings.steam_get_player,
  );
  server.registerTool(
    "steam_get_library",
    contracts.steam_get_library,
    bindings.steam_get_library,
  );
  server.registerTool(
    "steam_get_recent_activity",
    contracts.steam_get_recent_activity,
    bindings.steam_get_recent_activity,
  );
  server.registerTool(
    "steam_get_achievements",
    contracts.steam_get_achievements,
    bindings.steam_get_achievements,
  );
  server.registerTool(
    "steam_get_friends",
    contracts.steam_get_friends,
    bindings.steam_get_friends,
  );
  server.registerTool(
    "steam_get_wishlist",
    contracts.steam_get_wishlist,
    bindings.steam_get_wishlist,
  );
  server.registerTool(
    "steam_search_games",
    contracts.steam_search_games,
    bindings.steam_search_games,
  );
  server.registerTool(
    "steam_get_game",
    contracts.steam_get_game,
    bindings.steam_get_game,
  );
}
