import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";

import {
  canonicalArchiveDigest,
  npmPublicationAction,
  releaseArchiveName,
} from "./release-support.mjs";

const MAX_REGISTRY_ARCHIVE_BYTES = 32 * 1024 * 1024;

function archiveIntegrity(archive) {
  return `sha512-${createHash("sha512").update(archive).digest("base64")}`;
}

async function downloadRegistryArchive(url) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "registry.npmjs.org"
  ) {
    throw new Error("Registry returned an invalid package tarball URL");
  }
  const response = await globalThis.fetch(parsed);
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    !response.ok ||
    (Number.isFinite(declaredLength) &&
      declaredLength > MAX_REGISTRY_ARCHIVE_BYTES)
  ) {
    throw new Error("Registry package download failed");
  }
  const archive = new Uint8Array(await response.arrayBuffer());
  if (archive.byteLength > MAX_REGISTRY_ARCHIVE_BYTES) {
    throw new Error("Registry package exceeded the download limit");
  }
  return archive;
}

export async function publishNpmPackage(options) {
  const {
    archiveArgument,
    evidenceArgument,
    cwd = process.cwd(),
    download = downloadRegistryArchive,
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

  const localArchive = await readFile(archive);
  const localIntegrity = archiveIntegrity(localArchive);
  const localContentDigest = canonicalArchiveDigest(localArchive);
  const packageVersion = `${manifest.name}@${manifest.version}`;

  const publishedPackage = async () => {
    const result = run("pnpm", ["view", packageVersion, "dist", "--json"]);
    if (result.status === 0) {
      const parsed = JSON.parse(result.stdout);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("integrity" in parsed) ||
        typeof parsed.integrity !== "string" ||
        !("tarball" in parsed) ||
        typeof parsed.tarball !== "string"
      ) {
        throw new Error("Registry returned invalid package integrity metadata");
      }
      const registryArchive = await download(parsed.tarball);
      if (archiveIntegrity(registryArchive) !== parsed.integrity) {
        throw new Error(
          "Registry package download failed integrity validation",
        );
      }
      return {
        integrity: parsed.integrity,
        contentDigest: canonicalArchiveDigest(registryArchive),
      };
    }
    const lookupOutput = `${result.stdout}\n${result.stderr}`;
    if (
      lookupOutput.includes("ERR_PNPM_FETCH_404") ||
      lookupOutput.includes("ERR_PNPM_PACKAGE_NOT_FOUND") ||
      lookupOutput.includes("404")
    ) {
      return undefined;
    }
    throw new Error("Registry package lookup failed");
  };

  const existingPackage = await publishedPackage();
  const action = npmPublicationAction(
    localContentDigest,
    existingPackage?.contentDigest,
  );
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

  let registryPackage;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    registryPackage = await publishedPackage();
    if (registryPackage !== undefined) {
      npmPublicationAction(localContentDigest, registryPackage.contentDigest);
      break;
    }
    await wait(5_000);
  }
  if (registryPackage === undefined) {
    throw new Error("Published package was not visible before the deadline");
  }

  await writeFile(
    resolve(cwd, evidenceArgument),
    `${JSON.stringify({
      package: packageVersion,
      integrity: registryPackage.integrity,
      releaseArtifactIntegrity: localIntegrity,
      canonicalTarSha256: localContentDigest,
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
