import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["node_modules/**", "dist/**"],
    include: ["test/live/**/*.test.ts"],
    passWithNoTests: true,
    sequence: {
      concurrent: false,
      shuffle: false,
    },
    testTimeout: 15_000,
  },
});
