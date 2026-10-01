import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "~fixtures": fileURLToPath(new URL("./tests/fixtures", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    // The end-to-end suite is Playwright's, not this runner's.
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
    restoreMocks: true,
  },
});
