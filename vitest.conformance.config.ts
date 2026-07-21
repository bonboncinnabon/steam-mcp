import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/conformance/**/*.test.ts"],
    passWithNoTests: false,
    testTimeout: 15_000,
  },
});
