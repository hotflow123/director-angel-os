import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@hotflow/channels-core": fileURLToPath(
        new URL("../../packages/channels-core/src/index.ts", import.meta.url),
      ),
      "@hotflow/config": fileURLToPath(
        new URL("../../packages/config/src/index.ts", import.meta.url),
      ),
      "@hotflow/context": fileURLToPath(
        new URL("../../packages/context/src/index.ts", import.meta.url),
      ),
      "@hotflow/contracts": fileURLToPath(
        new URL("../../packages/contracts/src/index.ts", import.meta.url),
      ),
      "@hotflow/engine": fileURLToPath(
        new URL("../../packages/engine/src/index.ts", import.meta.url),
      ),
      "@hotflow/memory-core": fileURLToPath(
        new URL("../../packages/memory-core/src/index.ts", import.meta.url),
      ),
      "@hotflow/mempalace-adapter": fileURLToPath(
        new URL("../../services/mempalace-adapter/src/index.ts", import.meta.url),
      ),
      "@hotflow/models": fileURLToPath(
        new URL("../../packages/models/src/index.ts", import.meta.url),
      ),
      "@hotflow/observability": fileURLToPath(
        new URL("../../packages/observability/src/index.ts", import.meta.url),
      ),
      "@hotflow/plugin-runtime": fileURLToPath(
        new URL("../../packages/plugin-runtime/src/index.ts", import.meta.url),
      ),
      "@hotflow/runtime-bootstrap": fileURLToPath(
        new URL("../runtime-bootstrap/src/index.ts", import.meta.url),
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
      "@hotflow/tools": fileURLToPath(
        new URL("../../packages/tools/src/index.ts", import.meta.url),
      ),
      "@hotflow/internal-plugin-provider-scripted": fileURLToPath(
        new URL("../../internal-plugins/providers/scripted/src/index.ts", import.meta.url),
      ),
      "@hotflow/internal-plugin-tool-filesystem-read": fileURLToPath(
        new URL("../../internal-plugins/tools/filesystem-read/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/._*"],
  },
});
