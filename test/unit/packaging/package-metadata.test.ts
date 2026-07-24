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

    expect(manifest["private"]).not.toBe(true);
    expect(manifest["version"]).toBe("0.1.0");
    expect(manifest["bin"]).toEqual({
      "steam-mcp": "dist/bin/steam-mcp.js",
      "steam-mcp-hosted": "dist/bin/steam-mcp-hosted.js",
    });
    expect(manifest["engines"]).toEqual({
      node: ">=22.22.0 <23 || >=24.0.0",
    });
    expect(manifest["packageManager"]).toBe("pnpm@11.15.1");
  });

  it("pins every production dependency and publishes required files", async () => {
    const manifest = await packageJson();
    const dependencies = manifest["dependencies"] as Record<string, string>;

    expect(Object.values(dependencies)).not.toContainEqual(
      expect.stringMatching(/^[~^*]/u),
    );
    expect(manifest["files"]).toEqual(
      expect.arrayContaining(["dist", "README.md", "LICENSE", "docs"]),
    );
    await expect(access(resolve(root, "LICENSE"))).resolves.toBeUndefined();
  });

  it("includes release source, support, verification, and checksum metadata", async () => {
    const manifest = await packageJson();

    expect(manifest["repository"]).toEqual({
      type: "git",
      url: "git+https://github.com/abiswas97/steam-mcp.git",
    });
    expect(manifest["bugs"]).toEqual({
      url: "https://github.com/abiswas97/steam-mcp/issues",
    });
    expect(manifest["homepage"]).toBe(
      "https://github.com/abiswas97/steam-mcp#readme",
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
    expect(packageVerification).toContain("steam-mcp-hosted");
  });

  it("pins release provenance and uploads checksummed artifacts", async () => {
    const workflow = await readFile(
      resolve(root, ".github/workflows/release.yml"),
      "utf8",
    );

    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain(
      "actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a",
    );
    expect(workflow).toContain("subject-path: artifacts/*");
    expect(workflow).toContain("pnpm package:release");
    expect(workflow).toContain("gh release upload");
  });

  it("publishes an immutable self-hosted container without deploying a service", async () => {
    const workflow = await readFile(
      resolve(root, ".github/workflows/release.yml"),
      "utf8",
    );

    expect(workflow).toContain("packages: write");
    expect(workflow).toContain("registry: ghcr.io");
    expect(workflow).toContain("ghcr.io/${{ github.repository }}");
    expect(workflow).toContain(
      "docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9",
    );
    expect(workflow).toContain(
      "docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302",
    );
    expect(workflow).toContain(
      "docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a",
    );
    expect(workflow).toContain("push: true");
    expect(workflow).toContain("provenance: mode=max");
    expect(workflow).toContain("sbom: true");
    expect(workflow).not.toMatch(/\b(?:deploy|kubectl|helm|ssh)\b/iu);
  });
});
