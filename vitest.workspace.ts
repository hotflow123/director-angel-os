import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "apps/*/vitest.config.ts",
  "internal-plugins/*/*/vitest.config.ts",
  "packages/*/vitest.config.ts",
  "services/*/vitest.config.ts",
]);
