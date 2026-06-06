import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createFilesystemReadTextTool } from "../src/index.js";

describe("createFilesystemReadTextTool", () => {
  it("resolves relative paths from workspaceRoot instead of process.cwd()", async () => {
    const sandboxRoot = await mkdtemp(join(tmpdir(), "filesystem-read-text-"));
    const workspaceRoot = join(sandboxRoot, "workspace");
    const unrelatedCwd = join(sandboxRoot, "cwd");
    const originalCwd = process.cwd();

    await mkdir(workspaceRoot);
    await mkdir(unrelatedCwd);
    await writeFile(join(workspaceRoot, "note.txt"), "hello from workspace", "utf8");

    const tool = createFilesystemReadTextTool({
      allowedRoots: [workspaceRoot],
    });

    process.chdir(unrelatedCwd);
    try {
      const result = await tool.execute(
        { path: "note.txt" },
        { sessionId: "session_1", workspaceRoot },
      );

      expect(result.ok).toBe(true);
      expect(result.output).toBe("hello from workspace");
    } finally {
      process.chdir(originalCwd);
      await rm(sandboxRoot, { recursive: true, force: true });
    }
  });

  it("blocks symlink reads that escape the allowed roots", async () => {
    const sandboxRoot = await mkdtemp(join(tmpdir(), "filesystem-read-text-"));
    const workspaceRoot = join(sandboxRoot, "workspace");
    const outsideRoot = join(sandboxRoot, "outside");

    await mkdir(workspaceRoot);
    await mkdir(outsideRoot);
    await writeFile(join(outsideRoot, "secret.txt"), "top secret", "utf8");
    await symlink(join(outsideRoot, "secret.txt"), join(workspaceRoot, "escape.txt"));

    const tool = createFilesystemReadTextTool({
      allowedRoots: [workspaceRoot],
    });

    try {
      const result = await tool.execute(
        { path: join(workspaceRoot, "escape.txt") },
        { sessionId: "session_1", workspaceRoot },
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain("outside allowed roots");
    } finally {
      await rm(sandboxRoot, { recursive: true, force: true });
    }
  });

  it("allows symlink reads that resolve inside the allowed roots", async () => {
    const sandboxRoot = await mkdtemp(join(tmpdir(), "filesystem-read-text-"));
    const workspaceRoot = join(sandboxRoot, "workspace");
    const nestedRoot = join(workspaceRoot, "nested");

    await mkdir(workspaceRoot);
    await mkdir(nestedRoot);
    await writeFile(join(nestedRoot, "target.txt"), "inside workspace", "utf8");
    await symlink(join(nestedRoot, "target.txt"), join(workspaceRoot, "alias.txt"));

    const tool = createFilesystemReadTextTool({
      allowedRoots: [workspaceRoot],
    });

    try {
      const result = await tool.execute(
        { path: join(workspaceRoot, "alias.txt") },
        { sessionId: "session_1", workspaceRoot },
      );

      expect(result.ok).toBe(true);
      expect(result.output).toBe("inside workspace");
    } finally {
      await rm(sandboxRoot, { recursive: true, force: true });
    }
  });
});
