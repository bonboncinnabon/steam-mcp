import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const typeScriptFiles = ["src/**/*.ts", "test/**/*.ts", "vitest*.config.ts"];

export default tseslint.config(
  {
    ignores: [
      ".claude/**",
      ".codex/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "reports/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: typeScriptFiles,
  })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...config,
    files: typeScriptFiles,
  })),
  {
    files: typeScriptFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-confusing-void-expression": "error",
      "@typescript-eslint/no-deprecated": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
);
