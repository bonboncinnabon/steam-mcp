import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test/unit/infrastructure/http-request-boundary.test.ts",
      "test/unit/infrastructure/in-memory-quota.test.ts",
      "test/unit/infrastructure/safe-observability.test.ts",
      "test/unit/transports/hosted-lifecycle.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json"],
      include: [
        "src/infrastructure/http-request-boundary.ts",
        "src/infrastructure/in-memory-quota.ts",
        "src/infrastructure/safe-observability.ts",
        "src/transports/hosted-lifecycle.ts",
      ],
      thresholds: {
        branches: 100,
        functions: 95,
        lines: 90,
        statements: 90,
      },
    },
    sequence: { concurrent: false, shuffle: false },
    testTimeout: 5_000,
  },
});
