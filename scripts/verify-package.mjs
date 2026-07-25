import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { createServer } from "node:net";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";

import { releaseArchiveName } from "./release-support.mjs";

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
      const expectedExitCode = options.expectedExitCode ?? 0;
      if (code === expectedExitCode) {
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

function reserveLoopbackPort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a loopback port"));
        return;
      }
      server.close((error) => {
        if (error === undefined) {
          resolvePromise(address.port);
        } else {
          reject(error);
        }
      });
    });
  });
}

async function verifyHostedProcess(executable, cwd, environment) {
  const port = await reserveLoopbackPort();
  const child = spawn(executable, ["serve"], {
    cwd,
    env: {
      ...environment,
      ALLOWED_HOSTS: `127.0.0.1:${String(port)}`,
      LISTEN_HOST: "127.0.0.1",
      MCP_ACCESS_TOKEN: "synthetic-package-verification-token",
      MCP_RESOURCE_URI: `https://127.0.0.1:${String(port)}/mcp`,
      PORT: String(port),
      STEAM_API_KEY: "synthetic-package-verification-key",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolvePromise({ code, signal });
    });
  });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (child.exitCode !== null) {
        throw new Error(
          `Hosted package exited before readiness (${String(child.exitCode)})`,
        );
      }
      try {
        const response = await globalThis.fetch(
          `http://127.0.0.1:${String(port)}/readyz`,
          { headers: { host: `127.0.0.1:${String(port)}` } },
        );
        if (response.status === 200) {
          ready = true;
          break;
        }
      } catch {
        // The process may still be binding; retry within the fixed deadline.
      }
      await delay(100);
    }
    if (!ready) {
      throw new Error("Hosted package did not become ready");
    }

    child.kill("SIGTERM");
    const result = await Promise.race([
      exited,
      delay(5_000).then(() => {
        throw new Error("Hosted package did not stop after SIGTERM");
      }),
    ]);
    if (result.code !== 0 || result.signal !== null) {
      throw new Error(
        `Hosted package stopped unexpectedly (${String(result.code)}, ${String(
          result.signal,
        )})`,
      );
    }
    if (stderr.length > 0) {
      throw new Error("Hosted package emitted diagnostics during clean smoke");
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
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
    const archiveName = releaseArchiveName(manifest.name, manifest.version);
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
    await run(
      join(
        consumer,
        "node_modules",
        ".bin",
        process.platform === "win32" ? "steam-mcp.cmd" : "steam-mcp",
      ),
      ["serve"],
      {
        cwd: consumer,
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) =>
              ![
                "STEAM_API_KEY",
                "MCP_ACCESS_TOKEN",
                "MCP_RESOURCE_URI",
                "ALLOWED_HOSTS",
              ].includes(name),
          ),
        ),
        stdio: ["ignore", "ignore", "pipe"],
        timeoutMs: 5_000,
        expectedExitCode: 1,
      },
    );
    await verifyHostedProcess(
      join(
        consumer,
        "node_modules",
        ".bin",
        process.platform === "win32" ? "steam-mcp.cmd" : "steam-mcp",
      ),
      consumer,
      process.env,
    );

    process.stdout.write(
      `Verified ${basename(firstArchive)} sha256=${firstDigest}\n`,
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

await main();
