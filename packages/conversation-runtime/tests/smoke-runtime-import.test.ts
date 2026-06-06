import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { assertFreshConversationRuntimeDist } from "../../../scripts/smoke-runtime-import.mjs";

describe("Moyin smoke runtime import guard", () => {
  it("fails fast when conversation-runtime source is newer than the dist build marker", () => {
    const root = mkdtempSync(join(tmpdir(), "angel-smoke-runtime-stale-"));
    const srcDir = join(root, "packages/conversation-runtime/src");
    const distDir = join(root, "packages/conversation-runtime/dist");
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(distDir, { recursive: true });
    const runtimePath = join(distDir, "index.js");
    const buildInfoPath = join(distDir, ".tsbuildinfo");
    const sourcePath = join(srcDir, "index.ts");
    writeFileSync(runtimePath, "export {};\n", "utf8");
    writeFileSync(buildInfoPath, "{}", "utf8");
    writeFileSync(sourcePath, "export const newer = true;\n", "utf8");

    expect(() => assertFreshConversationRuntimeDist(root, runtimePath)).toThrow(
      /Conversation runtime dist is older than source/,
    );
  });

  it("allows smoke scripts after the dist build marker is refreshed", () => {
    const root = mkdtempSync(join(tmpdir(), "angel-smoke-runtime-fresh-"));
    const srcDir = join(root, "packages/conversation-runtime/src");
    const distDir = join(root, "packages/conversation-runtime/dist");
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(distDir, { recursive: true });
    const runtimePath = join(distDir, "index.js");
    const buildInfoPath = join(distDir, ".tsbuildinfo");
    writeFileSync(join(srcDir, "index.ts"), "export const fresh = true;\n", "utf8");
    writeFileSync(runtimePath, "export {};\n", "utf8");
    writeFileSync(buildInfoPath, "{}", "utf8");

    expect(() => assertFreshConversationRuntimeDist(root, runtimePath)).not.toThrow();
  });
});
