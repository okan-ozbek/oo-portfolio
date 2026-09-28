import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    "dist/**", ".next/**", "out/**", ".sites-runtime/**", ".wrangler/**",
    "outputs/**", "work/**", "generated_images/**", "next-env.d.ts",
  ]),
]);
