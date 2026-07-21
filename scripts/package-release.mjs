import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifacts = resolve(root, "artifacts");
const manifest = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const archiveName = `${manifest.name}-${manifest.version}.tgz`;
const archive = resolve(artifacts, archiveName);
const checksum = `${archive}.sha256`;
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

for (const output of [archive, checksum]) {
  try {
    await access(output);
    throw new Error(`Release output already exists: ${output}`);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      continue;
    }
    throw error;
  }
}

await mkdir(artifacts, { recursive: true });
await new Promise((resolvePromise, reject) => {
  const child = spawn(
    packageManager,
    ["pack", "--pack-destination", artifacts],
    { cwd: root, stdio: "inherit" },
  );
  child.once("error", reject);
  child.once("exit", (code) => {
    if (code === 0) {
      resolvePromise();
    } else {
      reject(new Error(`pnpm pack failed with exit code ${String(code)}`));
    }
  });
});

const digest = createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
await writeFile(checksum, `${digest}  ${archiveName}\n`, { flag: "wx" });
process.stdout.write(`${archive}\n${checksum}\n`);
