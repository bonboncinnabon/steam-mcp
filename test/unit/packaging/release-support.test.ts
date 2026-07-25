import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { publishNpmPackage } from "../../../scripts/publish-npm.mjs";
import {
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

  it("publishes a missing exact archive and records verified registry evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "steam-mcp-publish-test-"));
    const archive = join(directory, "abiswas97-steam-mcp-0.1.0.tgz");
    const evidence = join(directory, "npm-registry.json");
    const archiveBytes = Buffer.from("release-candidate");
    const integrity = `sha512-${createHash("sha512")
      .update(archiveBytes)
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
          ? { status: 1, stdout: "", stderr: "404 Not Found" }
          : { status: 0, stdout: JSON.stringify(integrity), stderr: "" };
      },
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
      integrity,
    });
  });
});
