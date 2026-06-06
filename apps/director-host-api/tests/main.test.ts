import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveStandaloneWorkspaceRoot } from "../src/main.js";

describe("director host API standalone entrypoint", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves the repository workspace root when launched from the app package directory", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-root-"));
    tempRoots.push(workspaceRoot);
    const packageDirectory = join(workspaceRoot, "apps", "director-host-api");
    mkdirSync(join(packageDirectory, "src"), { recursive: true });
    mkdirSync(join(workspaceRoot, "参考仓库", "OpenCLI"), { recursive: true });
    writeFileSync(join(workspaceRoot, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
    writeFileSync(
      join(workspaceRoot, "参考仓库", "OpenCLI", "cli-manifest.json"),
      JSON.stringify({ commands: [] }),
      "utf8",
    );

    const originalCwd = process.cwd();
    try {
      process.chdir(packageDirectory);
      expect(realpathSync(resolveStandaloneWorkspaceRoot())).toBe(realpathSync(workspaceRoot));
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("keeps an explicit workspace root authoritative", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-api-explicit-root-"));
    tempRoots.push(workspaceRoot);

    expect(realpathSync(resolveStandaloneWorkspaceRoot(workspaceRoot))).toBe(
      realpathSync(workspaceRoot),
    );
  });
});
