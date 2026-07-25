import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

async function repositoryFile(path: string): Promise<string> {
  return readFile(resolve(root, path), "utf8");
}

describe("hosted container packaging", () => {
  it("builds from one immutable supported Node image with the pinned pnpm and frozen lockfile", async () => {
    const dockerfile = await repositoryFile("Dockerfile");
    const imageReferences = Array.from(
      dockerfile.matchAll(
        /^FROM (node:22\.22\.0-bookworm-slim@sha256:[a-f0-9]{64}) AS (?:build|runtime)$/gmu,
      ),
      ([, image]) => image,
    );

    expect(imageReferences).toHaveLength(2);
    expect(new Set(imageReferences)).toHaveLength(1);
    expect(dockerfile).toContain("corepack prepare pnpm@11.15.1 --activate");
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("RUN pnpm build");
  });
});
