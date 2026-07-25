import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { publishNpmPackage } from "../../../scripts/publish-npm.mjs";
import {
  canonicalArchiveDigest,
  npmPublicationAction,
  releaseArchiveName,
} from "../../../scripts/release-support.mjs";

describe("release support", () => {
  it("uses the registry tarball name for a scoped package", () => {
    expect(releaseArchiveName("@abiswas97/steam-mcp", "0.1.0")).toBe(
      "abiswas97-steam-mcp-0.1.0.tgz",
    );
  });

  it("publishes a missing version and reuses an identical version", () => {
    expect([
      npmPublicationAction("sha512-local", undefined),
      npmPublicationAction("sha512-local", "sha512-local"),
    ]).toEqual(["publish", "reuse"]);
  });

  it("rejects an existing version with different contents", () => {
    expect(() =>
      npmPublicationAction("sha512-local", "sha512-published"),
    ).toThrow("Published package integrity does not match the local artifact");
  });

  it("compares package content independently of gzip encoding", () => {
    const tar = Buffer.from("canonical package tar stream");
    const fast = gzipSync(tar, { level: 1 });
    const compact = gzipSync(tar, { level: 9 });

    expect(fast).not.toEqual(compact);
    expect(canonicalArchiveDigest(fast)).toBe(canonicalArchiveDigest(compact));
  });

  it.each([
    { label: "404", stdout: "", stderr: "404 Not Found" },
    {
      label: "pnpm package-not-found JSON",
      stdout: '{"error":{"code":"ERR_PNPM_PACKAGE_NOT_FOUND"}}',
      stderr: "",
    },
  ])(
    "publishes a missing exact archive reported as $label and records verified registry evidence",
    async ({ stdout, stderr }) => {
      const directory = await mkdtemp(
        join(tmpdir(), "steam-mcp-publish-test-"),
      );
      const archive = join(directory, "abiswas97-steam-mcp-0.1.0.tgz");
      const evidence = join(directory, "npm-registry.json");
      const tarBytes = Buffer.from("release-candidate");
      const archiveBytes = gzipSync(tarBytes, { level: 1 });
      const registryBytes = gzipSync(tarBytes, { level: 9 });
      const localIntegrity = `sha512-${createHash("sha512")
        .update(archiveBytes)
        .digest("base64")}`;
      const registryIntegrity = `sha512-${createHash("sha512")
        .update(registryBytes)
        .digest("base64")}`;
      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({ name: "@abiswas97/steam-mcp", version: "0.1.0" }),
      );
      await writeFile(archive, archiveBytes);

      const commands: string[][] = [];
      let registryChecks = 0;
      await publishNpmPackage({
        archiveArgument: archive,
        cwd: directory,
        evidenceArgument: evidence,
        run(command, arguments_) {
          commands.push([command, ...arguments_]);
          if (command === "npm") {
            return { status: 0, stdout: "", stderr: "" };
          }
          registryChecks += 1;
          return registryChecks === 1
            ? { status: 1, stdout, stderr }
            : {
                status: 0,
                stdout: JSON.stringify({
                  integrity: registryIntegrity,
                  tarball:
                    "https://registry.npmjs.org/@abiswas97/steam-mcp/-/steam-mcp-0.1.0.tgz",
                }),
                stderr: "",
              };
        },
        download: () => Promise.resolve(registryBytes),
        wait: () => Promise.resolve(),
      });

      expect(commands).toContainEqual([
        "npm",
        "publish",
        archive,
        "--access",
        "public",
        "--provenance",
      ]);
      expect(JSON.parse(await readFile(evidence, "utf8"))).toEqual({
        package: "@abiswas97/steam-mcp@0.1.0",
        integrity: registryIntegrity,
        releaseArtifactIntegrity: localIntegrity,
        canonicalTarSha256: canonicalArchiveDigest(archiveBytes),
      });
    },
  );
});
