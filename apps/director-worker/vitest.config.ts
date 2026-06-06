import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@hotflow/director-execution": resolve(
        __dirname,
        "../../packages/director-execution/src/index.ts",
      ),
      "@hotflow/director-execution-contracts": resolve(
        __dirname,
        "../../packages/director-execution-contracts/src/index.ts",
      ),
      "@hotflow/director-memory": resolve(__dirname, "../../packages/director-memory/src/index.ts"),
      "@hotflow/director-runtime": resolve(
        __dirname,
        "../../packages/director-runtime/src/index.ts",
      ),
      "@hotflow/director-host-contracts": resolve(
        __dirname,
        "../../packages/director-host-contracts/src/index.ts",
      ),
      "@hotflow/director-workspace": resolve(
        __dirname,
        "../../packages/director-workspace/src/index.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/._*.ts"],
  },
});
