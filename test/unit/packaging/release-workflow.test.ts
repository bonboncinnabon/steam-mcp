import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

function jobBodies(workflow: string): ReadonlyMap<string, string> {
  const jobs = workflow.slice(workflow.indexOf("\njobs:\n") + 7);
  const matches = Array.from(
    jobs.matchAll(/^\s{2}([a-z][a-z0-9-]*):[ \t]*$/gmu),
  );

  return new Map(
    matches.map((match, index) => {
      const name = match[1] ?? "";
      const start = match.index + match[0].length;
      const end = matches[index + 1]?.index ?? jobs.length;
      return [name, jobs.slice(start, end)] as const;
    }),
  );
}

function needs(job: string): readonly string[] {
  const value = /^\s{4}needs:\s*(.+)$/mu.exec(job)?.[1]?.trim();
  if (value === undefined) {
    return [];
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((entry) => entry.trim());
  }
  return [value];
}

function actions(job: string): readonly string[] {
  return Array.from(
    job.matchAll(/^\s+(?:-\s+)?uses:\s+([^@\s]+)@[^\s]+/gmu),
    ([, action]) => action ?? "",
  );
}

function commands(job: string): readonly string[] {
  return Array.from(
    job.matchAll(/^\s+(?:-\s+)?run:\s+(.+)$/gmu),
    ([, command]) => command?.trim() ?? "",
  );
}

function expectContainsAll(
  actual: readonly string[],
  expected: readonly string[],
): void {
  for (const value of expected) {
    expect(actual).toContain(value);
  }
}

describe("release workflow", () => {
  it("starts from a version tag and creates the release only after both publications", async () => {
    const workflow = await readFile(
      resolve(root, ".github/workflows/release.yml"),
      "utf8",
    );
    const jobs = jobBodies(workflow);

    expect({
      tagDriven: /^\s{4}tags:\n\s{6}- "v\*"$/mu.test(workflow),
      releaseEvent: /^\s{2}release:/mu.test(workflow),
      dependencies: Object.fromEntries(
        Array.from(jobs, ([name, body]) => [name, needs(body)]),
      ),
    }).toEqual({
      tagDriven: true,
      releaseEvent: false,
      dependencies: {
        verify: [],
        "attest-package": ["verify"],
        "publish-npm": ["attest-package"],
        "publish-container": ["attest-package"],
        "create-release": ["publish-npm", "publish-container"],
      },
    });
  });

  it("verifies the exact package candidate and preserves its immutable evidence", async () => {
    const workflow = await readFile(
      resolve(root, ".github/workflows/release.yml"),
      "utf8",
    );
    const verify = jobBodies(workflow).get("verify") ?? "";

    expectContainsAll(actions(verify), [
      "actions/checkout",
      "pnpm/action-setup",
      "actions/setup-node",
      "actions/upload-artifact",
    ]);
    expectContainsAll(commands(verify), [
      "pnpm install --frozen-lockfile",
      "pnpm check",
      "pnpm test:inspector",
      "pnpm package:verify",
      "pnpm package:release",
    ]);
    expect(verify).toContain("GITHUB_REF_NAME");
    expect(verify).toContain("git merge-base --is-ancestor");
    expect(verify).not.toContain("id-token: write");
    expect(verify).not.toContain("attestations: write");
    expect(verify).not.toContain("artifact-metadata: write");

    const attestation = jobBodies(workflow).get("attest-package") ?? "";
    expectContainsAll(actions(attestation), [
      "actions/download-artifact",
      "actions/attest-build-provenance",
    ]);
    expect(attestation).toContain("subject-path: artifacts/*");
    expect(attestation).toContain("id-token: write");
    expect(attestation).toContain("attestations: write");
    expect(attestation).toContain("artifact-metadata: write");
  });

  it("publishes and verifies npm and GHCR before creating the GitHub release with evidence", async () => {
    const workflow = await readFile(
      resolve(root, ".github/workflows/release.yml"),
      "utf8",
    );
    const jobs = jobBodies(workflow);
    const npm = jobs.get("publish-npm") ?? "";
    const container = jobs.get("publish-container") ?? "";
    const release = jobs.get("create-release") ?? "";
    const normalizedNpm = npm.replace(/\s+/gu, " ");
    const normalizedContainer = container.replace(/\s+/gu, " ");
    const normalizedRelease = release.replace(/\s+/gu, " ");

    expectContainsAll(actions(npm), [
      "actions/checkout",
      "pnpm/action-setup",
      "actions/setup-node",
      "actions/download-artifact",
      "actions/upload-artifact",
    ]);
    expect(normalizedNpm).toContain(
      "node scripts/publish-npm.mjs artifacts/*.tgz artifacts/npm-registry.json",
    );
    expectContainsAll(actions(container), [
      "actions/checkout",
      "docker/setup-buildx-action",
      "docker/login-action",
      "docker/metadata-action",
      "docker/build-push-action",
      "actions/attest-build-provenance",
      "actions/upload-artifact",
    ]);
    expect(normalizedContainer).toContain(
      'docker buildx imagetools inspect "ghcr.io/${GITHUB_REPOSITORY}@${{ steps.container.outputs.digest }}"',
    );
    expect(container).toContain("images: ghcr.io/${{ github.repository }}");
    expect(container).toContain("type=semver,pattern={{version}}");
    expect(container).toContain("type=sha,format=long");
    expect(container).toContain("push: true");
    expectContainsAll(actions(release), ["actions/download-artifact"]);
    expect(normalizedRelease).toContain(
      'gh release create "$GITHUB_REF_NAME" artifacts/* --verify-tag --generate-notes --title "$GITHUB_REF_NAME"',
    );
    expect(npm).toContain("id-token: write");
    expect(npm).toContain("package-manager-cache: false");
    expect(normalizedNpm).toContain("npm 11.5.1+ required");
    expect(container).toContain("subject-digest:");
    expect(container).toContain("artifact-metadata: write");
    expect(container).toContain("provenance: mode=max");
    expect(container).toContain("sbom: true");
  });
});
