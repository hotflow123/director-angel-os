import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ToolRegistry } from "@hotflow/tools";
import { describe, expect, test } from "vitest";

import { filesystemReadToolPlugin } from "../src/index.js";

describe("filesystemReadToolPlugin", () => {
  test("registers workspace-scoped filesystem read tool", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-filesystem-plugin-"));
    const registry = new ToolRegistry();

    try {
      const registeredIds = filesystemReadToolPlugin.register({
        config: {
          workspaceRoot,
          dataDir: `${workspaceRoot}/.hotflow`,
          sessionDbPath: `${workspaceRoot}/.hotflow/sessions.sqlite`,
          defaultProvider: "scripted",
          defaultModel: "hotflow-phase1",
        },
        registry,
      });

      expect(registeredIds).toEqual(["filesystem.read_text"]);
      const tool = registry.get("filesystem.read_text");
      expect(tool).toBeDefined();

      const filePath = join(workspaceRoot, "README.md");
      writeFileSync(filePath, "plugin runtime", "utf8");
      const result = await tool?.execute(
        { path: filePath },
        { sessionId: "session_1", workspaceRoot },
      );
      expect(result.ok).toBe(true);
      expect(result.output).toBe("plugin runtime");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
