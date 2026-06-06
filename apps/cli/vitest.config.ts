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
      "@hotflow/config": fileURLToPath(
        new URL("../../packages/config/src/index.ts", import.meta.url),
      ),
      "@hotflow/control-plane": fileURLToPath(
        new URL("../../packages/control-plane/src/index.ts", import.meta.url),
      ),
      "@hotflow/contracts": fileURLToPath(
        new URL("../../packages/contracts/src/index.ts", import.meta.url),
      ),
      "@hotflow/director-host-contracts": fileURLToPath(
        new URL("../../packages/director-host-contracts/src/index.ts", import.meta.url),
      ),
      "@hotflow/director-knowledge": fileURLToPath(
        new URL("../../packages/director-knowledge/src/index.ts", import.meta.url),
      ),
      "@hotflow/director-memory": fileURLToPath(
        new URL("../../packages/director-memory/src/index.ts", import.meta.url),
      ),
      "@hotflow/director-memory-contracts": fileURLToPath(
        new URL("../../packages/director-memory-contracts/src/index.ts", import.meta.url),
      ),
      "@hotflow/director-runtime": fileURLToPath(
        new URL("../../packages/director-runtime/src/index.ts", import.meta.url),
      ),
      "@hotflow/director-workspace": fileURLToPath(
        new URL("../../packages/director-workspace/src/index.ts", import.meta.url),
      ),
      "@hotflow/doctor": fileURLToPath(
        new URL("../../packages/doctor/src/index.ts", import.meta.url),
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
      "@hotflow/policy-runtime": fileURLToPath(
        new URL("../../packages/policy-runtime/src/index.ts", import.meta.url),
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
    include: ["src/**/*.test.ts"],
    exclude: ["**/._*"],
  },
});
