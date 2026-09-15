import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/.next/**", "**/dist/**", "**/node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["scripts/*.mjs"], languageOptions: { globals: { process: "readonly", URL: "readonly", fetch: "readonly", setTimeout: "readonly", crypto: "readonly", console: "readonly" } } },
  { files: ["**/*.{ts,tsx}"], rules: { "@typescript-eslint/no-explicit-any": "off" } }
);
