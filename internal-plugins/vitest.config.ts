import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/._*", "**/dist/**", "**/node_modules/**"],
    include: ["providers/**/tests/**/*.test.ts", "tools/**/tests/**/*.test.ts"],
  },
});
