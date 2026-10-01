import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * The framework's own config ships as flat config arrays, so they are spread in
 * directly rather than wrapped in the compatibility layer, which cannot
 * serialize them.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
  ...coreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      // Every medical string this app shows comes from the API, so it is read
      // out of a typed response rather than written here. A literal apostrophe
      // in prose is fine, and the escaped-entity rule only makes the copy
      // harder to read and to check against its source.
      "react/no-unescaped-entities": "off",
    },
  },
];

export default config;
