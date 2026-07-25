import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

async function workflowRunCommands(path: string): Promise<readonly string[]> {
  const workflow = await readFile(resolve(root, path), "utf8");

  return Array.from(
    workflow.matchAll(/^\s+run:\s+(.+)$/gmu),
    ([, command]) => command?.trim() ?? "",
  );
}

describe("CI workflow", () => {
  it("gates changes on Inspector conformance and the health of the built container", async () => {
    const commands = await workflowRunCommands(".github/workflows/ci.yml");
    const smoke = await readFile(
      resolve(root, "scripts/smoke-container.mjs"),
      "utf8",
    );

    expect(commands).toEqual(
      expect.arrayContaining([
        "pnpm test:inspector",
        "docker build --tag steam-mcp:ci .",
        "node scripts/smoke-container.mjs steam-mcp:ci",
      ]),
    );
    expect(smoke).toContain('method: "initialize"');
    expect(smoke).toContain("authorization: `Bearer ${accessToken}`");
    expect(smoke).toContain("response.status !== 200");
  });
});
