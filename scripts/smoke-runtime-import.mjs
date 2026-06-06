import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function importFreshConversationRuntime(workspaceRoot) {
  const runtimePath = join(workspaceRoot, "packages/conversation-runtime/dist/index.js");
  assertFreshConversationRuntimeDist(workspaceRoot, runtimePath);
  return import(pathToFileURL(runtimePath).href);
}

export function assertFreshConversationRuntimeDist(workspaceRoot, runtimePath) {
  if (!existsSync(runtimePath)) {
    throw new Error(
      "Conversation runtime dist is missing. Run `pnpm --filter @hotflow/conversation-runtime build` first.",
    );
  }

  if (process.env.MOYIN_SMOKE_SKIP_DIST_FRESHNESS_CHECK === "1") {
    return;
  }

  const srcRoot = join(workspaceRoot, "packages/conversation-runtime/src");
  const buildInfoPath = join(workspaceRoot, "packages/conversation-runtime/dist/.tsbuildinfo");
  const builtAtMs = existsSync(buildInfoPath) ? statSync(buildInfoPath).mtimeMs : statSync(runtimePath).mtimeMs;
  const newerSource = findNewestSourceFile(srcRoot, builtAtMs);
  if (newerSource !== undefined) {
    throw new Error(
      [
        "Conversation runtime dist is older than source; refusing to run Moyin smoke against stale runtime.",
        `Newer source: ${newerSource}`,
        "Run `pnpm --filter @hotflow/conversation-runtime build` first.",
      ].join("\n"),
    );
  }
}

function findNewestSourceFile(root, distMtimeMs) {
  if (!existsSync(root)) {
    return undefined;
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith("._")) {
      continue;
    }
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findNewestSourceFile(path, distMtimeMs);
      if (nested !== undefined) {
        return nested;
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".ts")) {
      continue;
    }
    if (statSync(path).mtimeMs > distMtimeMs) {
      return path;
    }
  }
  return undefined;
}

export function currentWorkspaceRootFromScript(importMetaUrl) {
  return dirname(dirname(fileURLToPath(importMetaUrl)));
}
