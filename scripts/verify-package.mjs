import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      stdio: options.stdio ?? "inherit",
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out: ${command} ${args.join(" ")}`));
    }, options.timeoutMs ?? 60_000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolvePromise();
      } else {
        reject(
          new Error(`Failed (${String(code)}): ${command} ${args.join(" ")}`),
        );
      }
    });
  });
}

async function digest(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function main() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "steam-mcp-package-"));
  const first = join(temporaryRoot, "first");
  const second = join(temporaryRoot, "second");
  const consumer = join(temporaryRoot, "consumer");
  await Promise.all([mkdir(first), mkdir(second), mkdir(consumer)]);

  try {
    await run(packageManager, ["pack", "--pack-destination", first]);
    await run(packageManager, ["pack", "--pack-destination", second]);

    const manifest = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    );
    const archiveName = `${manifest.name}-${manifest.version}.tgz`;
    const firstArchive = join(first, archiveName);
    const secondArchive = join(second, archiveName);
    const [firstDigest, secondDigest] = await Promise.all([
      digest(firstArchive),
      digest(secondArchive),
    ]);
    if (firstDigest !== secondDigest) {
      throw new Error("Package archives are not reproducible");
    }

    await writeFile(
      join(consumer, "package.json"),
      JSON.stringify({ name: "steam-mcp-package-consumer", private: true }),
    );
    await run(
      packageManager,
      ["add", "--prefer-offline", "--ignore-scripts", firstArchive],
      { cwd: consumer },
    );
    await run(
      join(
        consumer,
        "node_modules",
        ".bin",
        process.platform === "win32" ? "steam-mcp.cmd" : "steam-mcp",
      ),
      [],
      {
        cwd: consumer,
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) => name !== "STEAM_API_KEY" && name !== "STEAM_USER",
          ),
        ),
        stdio: ["ignore", "ignore", "pipe"],
        timeoutMs: 5_000,
      },
    );

    process.stdout.write(
      `Verified ${basename(firstArchive)} sha256=${firstDigest}\n`,
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

await main();
