import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@hotflow/agent-os-kernel-contracts": fileURLToPath(
        new URL("../../packages/agent-os-kernel-contracts/src/index.ts", import.meta.url),
      ),
      "@hotflow/agent-os-runtime-mapping": fileURLToPath(
        new URL("../../packages/agent-os-runtime-mapping/src/index.ts", import.meta.url),
      ),
      "@hotflow/director-entry-contracts": fileURLToPath(
        new URL("../../packages/director-entry-contracts/src/index.ts", import.meta.url),
      ),
      "@hotflow/director-host-contracts": fileURLToPath(
        new URL("../../packages/director-host-contracts/src/index.ts", import.meta.url),
      ),
      "@hotflow/director-core": fileURLToPath(
        new URL("../../packages/director-core/src/index.ts", import.meta.url),
      ),
      "@hotflow/director-knowledge": fileURLToPath(
        new URL("../../packages/director-knowledge/src/index.ts", import.meta.url),
      ),
      "@hotflow/director-service": fileURLToPath(
        new URL("../../packages/director-service/src/service.ts", import.meta.url),
      ),
      "@hotflow/director-runtime": fileURLToPath(
        new URL("../../packages/director-runtime/src/index.ts", import.meta.url),
      ),
      "@hotflow/director-workspace": fileURLToPath(
        new URL("../../packages/director-workspace/src/index.ts", import.meta.url),
      ),
      "@hotflow/memory-core": fileURLToPath(
        new URL("../../packages/memory-core/src/index.ts", import.meta.url),
      ),
      "@hotflow/sessions": fileURLToPath(
        new URL("../../packages/sessions/src/index.ts", import.meta.url),
      ),
      "@hotflow/skills": fileURLToPath(
        new URL("../../packages/skills/src/index.ts", import.meta.url),
      ),
      "@hotflow/tasks-core": fileURLToPath(
        new URL("../../packages/tasks-core/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["**/._*"],
  },
});
