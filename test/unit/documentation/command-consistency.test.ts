import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(resolve(root, directory), {
    recursive: true,
    withFileTypes: true,
  });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) =>
      resolve(entry.parentPath, entry.name).slice(root.length + 1),
    );
}

describe("documentation commands", () => {
  it("match the public package name and single executable", async () => {
    const manifest = JSON.parse(
      await readFile(resolve(root, "package.json"), "utf8"),
    ) as {
      bin: Record<string, string>;
      name: string;
    };
    const [binName] = Object.keys(manifest.bin);
    const paths = [
      "README.md",
      ...(await markdownFiles("docs")),
      ...(await markdownFiles("openspec/changes/build-steam-mcp-server")),
    ];
    const problems: string[] = [];

    for (const path of paths) {
      const contents = await readFile(resolve(root, path), "utf8");

      if (contents.includes("steam-mcp-server")) {
        problems.push(`${path}: legacy package name`);
      }
      if (contents.includes("steam-mcp-hosted")) {
        problems.push(`${path}: legacy hosted executable`);
      }
    }

    const requiredCommands = {
      "README.md": [
        `pnpm dlx ${manifest.name}`,
        `pnpm dlx ${manifest.name} serve`,
      ],
      "docs/hosted-setup.md": [`pnpm dlx ${manifest.name} serve`],
      "docs/local-setup.md": [`pnpm dlx ${manifest.name}`],
      "docs/operations.md": [`pnpm dlx ${manifest.name} serve`],
    } as const;

    for (const [path, commands] of Object.entries(requiredCommands)) {
      const contents = await readFile(resolve(root, path), "utf8");
      for (const command of commands) {
        if (!contents.includes(command)) {
          problems.push(`${path}: missing \`${command}\``);
        }
      }
    }

    if (binName !== "steam-mcp") {
      problems.push(
        `package.json: unexpected executable \`${String(binName)}\``,
      );
    }

    expect(problems).toEqual([]);
  });
});
