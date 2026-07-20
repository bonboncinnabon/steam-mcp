import { mergeConfig } from "vitest/config";

import baseConfig from "./vitest.config.js";

export default mergeConfig(baseConfig, {
  test: {
    include: ["test/live/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 15_000,
  },
});
