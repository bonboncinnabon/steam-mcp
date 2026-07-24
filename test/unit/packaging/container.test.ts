import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

async function repositoryFile(path: string): Promise<string> {
  return readFile(resolve(root, path), "utf8");
}

describe("hosted container packaging", () => {
  it("builds with the pinned supported Node and pnpm versions from the frozen lockfile", async () => {
    const dockerfile = await repositoryFile("Dockerfile");

    expect(dockerfile).toMatch(
      /^FROM node:22\.22\.0-bookworm-slim AS build$/mu,
    );
    expect(dockerfile).toContain("corepack prepare pnpm@11.15.1 --activate");
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("RUN pnpm build");
  });

  it("runs one hosted process as a non-root user with only production artifacts and a built-in health probe", async () => {
    const dockerfile = await repositoryFile("Dockerfile");

    expect(dockerfile).toContain("RUN pnpm prune --prod");
    expect(dockerfile).toMatch(
      /^FROM node:22\.22\.0-bookworm-slim AS runtime$/mu,
    );
    expect(dockerfile).toContain(
      "COPY --from=build --chown=node:node /app/package.json ./package.json",
    );
    expect(dockerfile).toContain(
      "COPY --from=build --chown=node:node /app/node_modules ./node_modules",
    );
    expect(dockerfile).toContain(
      "COPY --from=build --chown=node:node /app/dist ./dist",
    );
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain("EXPOSE 3000");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("process.env.PORT ?? 3000");
    expect(dockerfile).toContain("new URL(process.env.MCP_RESOURCE_URI).host");
    expect(dockerfile).toContain("require('node:http').get");
    expect(dockerfile).not.toContain("fetch(`http://127.0.0.1");
    expect(dockerfile).toContain("headers: { host }");
    expect(dockerfile).toContain("/livez");
    expect(dockerfile).not.toMatch(/\b(?:curl|wget|npm)\b/u);
    expect(dockerfile).toContain(
      'CMD ["node", "dist/bin/steam-mcp-hosted.js"]',
    );
  });

  it("limits the build context to locked dependency, compiler, build-script, and source inputs", async () => {
    const dockerignore = await repositoryFile(".dockerignore");

    expect(dockerignore.trim().split("\n")).toEqual([
      "*",
      "!package.json",
      "!pnpm-lock.yaml",
      "!pnpm-workspace.yaml",
      "!tsconfig.json",
      "!tsconfig.build.json",
      "!scripts/",
      "!scripts/clean-dist.mjs",
      "!src/",
      "!src/**",
    ]);
  });

  it("gates CI on a local container build while retaining both supported Node lines", async () => {
    const workflow = await repositoryFile(".github/workflows/ci.yml");

    expect(workflow).toContain('- "22.22.0"');
    expect(workflow).toContain('- "24"');
    expect(workflow).toContain("container-build:");
    expect(workflow).toContain("run: docker build --tag steam-mcp-hosted:ci .");
    expect(workflow).not.toMatch(/docker (?:push|login)|build-push-action/u);
  });
});
