import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // `const { stripped, ...rest } = obj` is how scanner.mjs excludes keys —
      // the "unused" binding is the point.
      "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true, args: "after-used", argsIgnorePattern: "^_" }],
    },
  },
]);

export default eslintConfig;
