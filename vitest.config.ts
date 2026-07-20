import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: ["src/bin/**"],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json", "html"],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
    exclude: ["test/live/**", "node_modules/**", "dist/**"],
    passWithNoTests: true,
    sequence: {
      concurrent: false,
      shuffle: false,
    },
    testTimeout: 5_000,
  },
});
