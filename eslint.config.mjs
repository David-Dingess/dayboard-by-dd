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
    // The Stream Deck plugin's bundle. esbuild output, rebuilt by deck/'s own
    // build — its source in deck/src is linted, the 130KB of it is not.
    "deck/com.dayboard.deck.sdPlugin/bin/**",
  ]),
]);

export default eslintConfig;
