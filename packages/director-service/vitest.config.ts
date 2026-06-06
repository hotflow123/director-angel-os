import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@hotflow/director-core": fileURLToPath(
        new URL("../../packages/director-core/dist/index.js", import.meta.url),
      ),
      "@hotflow/director-host-contracts": fileURLToPath(
        new URL("../../packages/director-host-contracts/dist/index.js", import.meta.url),
      ),
      "@hotflow/director-knowledge": fileURLToPath(
        new URL("../../packages/director-knowledge/src/index.ts", import.meta.url),
      ),
      "@hotflow/director-runtime": fileURLToPath(
        new URL("../../packages/director-runtime/dist/index.js", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["**/._*"],
  },
});
