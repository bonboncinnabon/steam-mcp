import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

async function packageJson(): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
  ) as Record<string, unknown>;
}

describe("public package metadata", () => {
  it("defines a public non-placeholder release and supported executable", async () => {
    const manifest = await packageJson();

    expect(manifest["name"]).toBe("@abiswas97/steam-mcp");
    expect(manifest["private"]).not.toBe(true);
    expect(manifest["version"]).toBe("0.1.2");
    expect(manifest["publishConfig"]).toEqual({ access: "public" });
    expect(manifest["bin"]).toEqual({
      "steam-mcp": "dist/bin/steam-mcp.js",
    });
    expect(manifest["engines"]).toEqual({
      node: ">=22.22.0 <23 || >=24.0.0",
    });
    expect(manifest["packageManager"]).toBe("pnpm@11.15.1");
  });

  it("publishes only runtime artifacts and user-facing documentation without source maps", async () => {
    const manifest = await packageJson();
    const dependencies = manifest["dependencies"] as Record<string, string>;
    const buildConfig = JSON.parse(
      await readFile(resolve(root, "tsconfig.build.json"), "utf8"),
    ) as {
      compilerOptions?: {
        declarationMap?: boolean;
        sourceMap?: boolean;
      };
    };

    expect(Object.values(dependencies)).not.toContainEqual(
      expect.stringMatching(/^[~^*]/u),
    );
    expect(manifest["files"]).toEqual([
      "dist",
      "README.md",
      "LICENSE",
      "docs/architecture.md",
      "docs/hosted-setup.md",
      "docs/local-setup.md",
      "docs/operations.md",
      "docs/testing.md",
      "docs/tool-reference.md",
      "docs/upstream-sources.md",
      "docs/adr/0002-static-bearer-authentication.md",
    ]);
    expect(buildConfig.compilerOptions).toMatchObject({
      declarationMap: false,
      sourceMap: false,
    });
    await expect(access(resolve(root, "LICENSE"))).resolves.toBeUndefined();
  });

  it("includes release source, support, verification, and checksum metadata", async () => {
    const manifest = await packageJson();

    expect(manifest["repository"]).toEqual({
      type: "git",
      url: "git+https://github.com/bonboncinnabon/steam-mcp.git",
    });
    expect(manifest["bugs"]).toEqual({
      url: "https://github.com/bonboncinnabon/steam-mcp/issues",
    });
    expect(manifest["homepage"]).toBe(
      "https://github.com/bonboncinnabon/steam-mcp#readme",
    );
    expect(manifest["scripts"]).toMatchObject({
      build: "node scripts/clean-dist.mjs && tsc -p tsconfig.build.json",
      "test:integration": "vitest run test/integration",
      "package:verify": "node scripts/verify-package.mjs",
      "package:release": "node scripts/package-release.mjs",
      prepack: "pnpm build",
    });
    const packageVerification = await readFile(
      resolve(root, "scripts/verify-package.mjs"),
      "utf8",
    );
    expect(packageVerification).not.toContain("steam-mcp-hosted");
    expect(packageVerification).toContain('["serve"]');
  });
});
