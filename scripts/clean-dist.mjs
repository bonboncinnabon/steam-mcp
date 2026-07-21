import { rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = resolve(root, "dist");

if (dirname(dist) !== root || basename(dist) !== "dist") {
  throw new Error("Refusing to clean an unexpected build path");
}

await rm(dist, { force: true, recursive: true });
