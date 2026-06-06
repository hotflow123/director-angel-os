import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@hotflow/config": resolve(packageRoot, "../config/src/index.ts"),
      "@hotflow/control-plane": resolve(packageRoot, "../control-plane/src/index.ts"),
      "@hotflow/contracts": resolve(packageRoot, "../contracts/src/index.ts"),
      "@hotflow/models": resolve(packageRoot, "../models/src/index.ts"),
      "@hotflow/sessions": resolve(packageRoot, "../sessions/src/index.ts"),
      "@hotflow/tasks-core": resolve(packageRoot, "../tasks-core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["**/._*"],
  },
});
