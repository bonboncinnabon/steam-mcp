import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const LOCAL_STATE_MODULES = [
  new URL("../../../src/infrastructure/in-memory-quota.ts", import.meta.url),
  new URL(
    "../../../src/infrastructure/in-memory-concurrency.ts",
    import.meta.url,
  ),
];

describe("process-local state boundaries", () => {
  it("contains no disk or hosted-storage dependency", () => {
    const source = LOCAL_STATE_MODULES.map((url) =>
      readFileSync(url, "utf8"),
    ).join("\n");

    expect(source).not.toMatch(/node:(?:fs|sqlite)/u);
    expect(source).not.toMatch(/postgres|redis|database_url|redis_url/iu);
    expect(source).not.toMatch(/writeFile|appendFile|createWriteStream/u);
  });
});
