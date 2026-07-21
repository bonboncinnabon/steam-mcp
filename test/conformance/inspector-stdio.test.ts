import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const inspectorPackageDirectory = dirname(
  require.resolve("@modelcontextprotocol/inspector-cli/package.json"),
);

describe("MCP Inspector stdio conformance", () => {
  it("negotiates with the packaged command and lists the exact public tools", async () => {
    const { stdout, stderr } = await runInspector("--method", "tools/list");
    const result = JSON.parse(stdout) as {
      readonly tools: readonly { readonly name: string }[];
    };

    expect(result.tools.map((tool) => tool.name)).toEqual([
      "steam_get_player",
      "steam_get_library",
      "steam_get_recent_activity",
      "steam_get_achievements",
      "steam_get_friends",
      "steam_get_wishlist",
      "steam_search_games",
      "steam_get_game",
    ]);
    expect(stderr).toBe("");
  });

  it("returns a structured missing-credential error without stderr leakage", async () => {
    const { stdout, stderr } = await runInspector(
      "--method",
      "tools/call",
      "--tool-name",
      "steam_get_player",
      "--tool-arg",
      "user=synthetic_player",
    );
    const result = JSON.parse(stdout) as {
      readonly isError?: boolean;
      readonly structuredContent?: {
        readonly ok: boolean;
        readonly error?: { readonly code: string; readonly message: string };
      };
    };

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: { code: "STEAM_AUTH_FAILED" },
      },
    });
    expect(stderr).toBe("");
  });
});

function runInspector(...methodArguments: string[]) {
  return execFileAsync(
    process.execPath,
    [
      resolve(inspectorPackageDirectory, "build/cli.js"),
      "--cli",
      process.execPath,
      resolve(process.cwd(), "dist/bin/steam-mcp.js"),
      ...methodArguments,
    ],
    { cwd: resolve(inspectorPackageDirectory, "build") },
  );
}
