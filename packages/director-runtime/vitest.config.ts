import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@hotflow/conversation-runtime": fileURLToPath(
        new URL("../../packages/conversation-runtime/src/index.ts", import.meta.url),
      ),
      "@hotflow/director-core": fileURLToPath(
        new URL("../../packages/director-core/dist/index.js", import.meta.url),
      ),
      "@hotflow/director-host-contracts": fileURLToPath(
        new URL("../../packages/director-host-contracts/dist/index.js", import.meta.url),
      ),
      "@hotflow/live-runner-core": fileURLToPath(
        new URL("../../packages/live-runner-core/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["**/._*"],
  },
});
