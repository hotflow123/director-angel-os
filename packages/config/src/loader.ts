import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { resolveProfile } from "./profile.js";
import { type HotflowConfig, HotflowConfigSchema } from "./schema.js";

export interface LoadConfigOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function loadConfig(options: LoadConfigOptions = {}): HotflowConfig {
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const profile = resolveProfile(env);

  const workspaceRoot = resolve(env.HOTFLOW_WORKSPACE_ROOT ?? detectWorkspaceRoot(cwd));
  const dataDir = resolve(env.HOTFLOW_DATA_DIR ?? join(workspaceRoot, ".hotflow"));
  const sessionDbPath = resolve(
    env.HOTFLOW_SESSION_DB_PATH ?? join(dataDir, "sessions", "sessions.sqlite"),
  );

  return HotflowConfigSchema.parse({
    profile,
    workspaceRoot,
    dataDir,
    sessionDbPath,
    defaultProvider: env.HOTFLOW_DEFAULT_PROVIDER ?? "scripted",
    defaultModel: env.HOTFLOW_DEFAULT_MODEL ?? "hotflow-phase1",
    permissionMode: env.HOTFLOW_PERMISSION_MODE ?? "ask",
    outputStyle: env.HOTFLOW_OUTPUT_STYLE ?? "normal",
    responseLanguage: env.HOTFLOW_RESPONSE_LANGUAGE ?? "follow-user",
  });
}

export function derivePaths(config: HotflowConfig) {
  return {
    workspaceRoot: config.workspaceRoot,
    dataDir: config.dataDir,
    sessionDbPath: config.sessionDbPath,
    sessionDir: dirname(config.sessionDbPath),
    benchmarkDir: resolve(config.workspaceRoot, "benchmarks"),
    docsDir: resolve(config.workspaceRoot, "docs"),
  };
}

function detectWorkspaceRoot(startCwd: string): string {
  let current = resolve(startCwd);

  while (true) {
    if (hasWorkspaceMarkers(current)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return startCwd;
    }
    current = parent;
  }
}

function hasWorkspaceMarkers(directory: string): boolean {
  return (
    existsSync(join(directory, "pnpm-workspace.yaml")) ||
    (existsSync(join(directory, "package.json")) && existsSync(join(directory, "turbo.json")))
  );
}
