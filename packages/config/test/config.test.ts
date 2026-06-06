import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { derivePaths, loadConfig, resolveProfile } from "../src/index.js";

describe("config", () => {
  it("resolves defaults from cwd", () => {
    const config = loadConfig({
      cwd: "/tmp/hotflow",
      env: {},
    });

    expect(config.workspaceRoot).toBe("/tmp/hotflow");
    expect(config.dataDir).toBe("/tmp/hotflow/.hotflow");
    expect(config.sessionDbPath).toBe("/tmp/hotflow/.hotflow/sessions/sessions.sqlite");
    expect(config.defaultProvider).toBe("scripted");
    expect(config.responseLanguage).toBe("follow-user");
  });

  it("walks up to the monorepo root when invoked from a package directory", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-angel-os-config-"));
    const packageCwd = join(workspaceRoot, "apps", "cli");
    mkdirSync(packageCwd, { recursive: true });
    writeFileSync(join(workspaceRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");

    try {
      const config = loadConfig({
        cwd: packageCwd,
        env: {},
      });

      expect(config.workspaceRoot).toBe(workspaceRoot);
      expect(config.dataDir).toBe(join(workspaceRoot, ".hotflow"));
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("honors environment overrides", () => {
    const config = loadConfig({
      cwd: "/tmp/hotflow",
      env: {
        NODE_ENV: "production",
        HOTFLOW_DEFAULT_PROVIDER: "openai-compatible",
        HOTFLOW_DEFAULT_MODEL: "gpt-5-mini",
        HOTFLOW_PERMISSION_MODE: "allow",
        HOTFLOW_OUTPUT_STYLE: "concise",
        HOTFLOW_RESPONSE_LANGUAGE: "zh-CN",
      },
    });

    expect(config.profile).toBe("production");
    expect(config.defaultProvider).toBe("openai-compatible");
    expect(config.defaultModel).toBe("gpt-5-mini");
    expect(config.permissionMode).toBe("allow");
    expect(config.outputStyle).toBe("concise");
    expect(config.responseLanguage).toBe("zh-CN");
  });

  it("derives stable directories", () => {
    const config = loadConfig({
      cwd: "/tmp/hotflow",
      env: {},
    });

    const paths = derivePaths(config);
    expect(paths.sessionDir).toBe("/tmp/hotflow/.hotflow/sessions");
    expect(paths.docsDir).toBe("/tmp/hotflow/docs");
  });

  it("resolves test profile", () => {
    expect(resolveProfile({ NODE_ENV: "test" })).toBe("test");
  });
});
