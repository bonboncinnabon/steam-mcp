import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  npmPublicationAction,
  releaseArchiveName,
} from "./release-support.mjs";

export async function publishNpmPackage(options) {
  const {
    archiveArgument,
    evidenceArgument,
    cwd = process.cwd(),
    run = (command, arguments_) =>
      spawnSync(command, arguments_, { encoding: "utf8" }),
    wait = delay,
  } = options;
  const manifest = JSON.parse(
    await readFile(resolve(cwd, "package.json"), "utf8"),
  );
  const archive = resolve(cwd, archiveArgument);
  if (
    basename(archive) !== releaseArchiveName(manifest.name, manifest.version)
  ) {
    throw new Error("Package archive name does not match package metadata");
  }

  const localIntegrity = `sha512-${createHash("sha512")
    .update(await readFile(archive))
    .digest("base64")}`;
  const packageVersion = `${manifest.name}@${manifest.version}`;

  const publishedIntegrity = () => {
    const result = run("pnpm", [
      "view",
      packageVersion,
      "dist.integrity",
      "--json",
    ]);
    if (result.status === 0) {
      const parsed = JSON.parse(result.stdout);
      if (typeof parsed !== "string") {
        throw new Error("Registry returned invalid package integrity metadata");
      }
      return parsed;
    }
    if (
      result.stderr.includes("ERR_PNPM_FETCH_404") ||
      result.stderr.includes("404")
    ) {
      return undefined;
    }
    throw new Error("Registry package lookup failed");
  };

  const action = npmPublicationAction(localIntegrity, publishedIntegrity());
  if (action === "publish") {
    const published = run("npm", [
      "publish",
      archive,
      "--access",
      "public",
      "--provenance",
    ]);
    if (published.status !== 0) {
      throw new Error("npm publication failed");
    }
  }

  let registryIntegrity;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    registryIntegrity = publishedIntegrity();
    if (registryIntegrity === localIntegrity) {
      break;
    }
    await wait(5_000);
  }
  if (registryIntegrity === undefined) {
    throw new Error("Published package was not visible before the deadline");
  }
  npmPublicationAction(localIntegrity, registryIntegrity);

  await writeFile(
    resolve(cwd, evidenceArgument),
    `${JSON.stringify({
      package: packageVersion,
      integrity: localIntegrity,
    })}\n`,
    { flag: "wx" },
  );
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [archiveArgument, evidenceArgument, ...unexpectedArguments] =
    process.argv.slice(2);
  if (
    archiveArgument === undefined ||
    evidenceArgument === undefined ||
    unexpectedArguments.length > 0
  ) {
    throw new Error(
      "Usage: node scripts/publish-npm.mjs <archive> <evidence-file>",
    );
  }
  await publishNpmPackage({ archiveArgument, evidenceArgument });
}
