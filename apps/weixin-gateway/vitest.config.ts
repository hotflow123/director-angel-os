import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/._*"],
  },
  resolve: {
    alias: {
      "@hotflow/contracts": fileURLToPath(
        new URL("../../packages/contracts/src/index.ts", import.meta.url),
      ),
      "@hotflow/channels-core": fileURLToPath(
        new URL("../../packages/channels-core/src/index.ts", import.meta.url),
      ),
      "@hotflow/conversation-runtime": fileURLToPath(
        new URL("../../packages/conversation-runtime/src/index.ts", import.meta.url),
      ),
      "@hotflow/skills": fileURLToPath(
        new URL("../../packages/skills/src/index.ts", import.meta.url),
      ),
    },
  },
});
