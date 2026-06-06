import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { recordCliAuditEvent } from "../../apps/cli/dist/bootstrap.js";
import { createCliControlPlane } from "../../apps/cli/dist/control-plane-adapter.js";
import { MemoryCoreManager } from "../../packages/memory-core/dist/index.js";
import { SessionStore } from "../../packages/sessions/dist/index.js";
import { getBenchmarksPaths, runWorkspaceBuild } from "./cli-command.mjs";

function fail(message, details) {
  if (details) {
    process.stderr.write(`${message}\n${details}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

async function dispatchOrThrow(controlPlane, action) {
  const result = await controlPlane.dispatch(action);
  if (!result.ok) {
    throw new Error(result.error ?? `Control-plane action failed: ${action.type}`);
  }
  return result.data;
}

function buildWorkspace(workspace, env) {
  const result = runWorkspaceBuild(workspace, env);
  if (result.status !== 0) {
    fail(`${workspace} build failed for wave62 status memory summary surface gate.`, result.stderr);
  }
}

async function runGate() {
  const { resultsDir } = getBenchmarksPaths();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave62-status-memory-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave62-status-memory-summary.sqlite");
  const sessionId = "sess_wave62_status_memory_summary";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(join(workspaceRoot, "README.md"), "Wave 62 status memory summary surface.\n");

  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
  };

  buildWorkspace("@hotflow/memory-core", env);
  buildWorkspace("@hotflow/sessions", env);
  buildWorkspace("@hotflow/control-plane", env);
  buildWorkspace("@hotflow/cli", env);

  const store = new SessionStore({ dbPath: sessionDbPath });
  const memory = new MemoryCoreManager();

  try {
    store.createSession({ sessionId });
    memory.writeLayer0({
      content: "working-status-a",
      scope: { sessionId },
    });
    memory.writeLayer0({
      content: "working-status-b",
      scope: { sessionId },
    });
    memory.writeLayer1({
      content: "episodic-status-a",
      scope: { sessionId },
    });

    const controlPlane = createCliControlPlane({
      sessionStore: store,
      memory,
      recordAuditEvent(input) {
        recordCliAuditEvent(store, input);
      },
    });

    const statusBefore = await dispatchOrThrow(controlPlane, {
      type: "status",
      sessionId,
    });
    const clearWorking = await dispatchOrThrow(controlPlane, {
      type: "memory-clear",
      sessionId,
      scope: "working",
    });
    const statusAfter = await dispatchOrThrow(controlPlane, {
      type: "status",
      sessionId,
    });

    const failures = [];

    if (statusBefore.workingMemoryEntries !== 2 || statusBefore.episodicMemoryEntries !== 1) {
      failures.push(
        "Expected status before clear to surface 2 working entries and 1 episodic entry.",
      );
    }
    if (
      clearWorking.beforeLayer0Count !== 2 ||
      clearWorking.afterLayer0Count !== 0 ||
      clearWorking.beforeLayer1Count !== 1 ||
      clearWorking.afterLayer1Count !== 1
    ) {
      failures.push("Expected memory-clear to preserve the wave61 before/after closure contract.");
    }
    if (statusAfter.workingMemoryEntries !== 0 || statusAfter.episodicMemoryEntries !== 1) {
      failures.push(
        "Expected status after clear to surface 0 working entries and 1 episodic entry.",
      );
    }

    const controlActionCount = store
      .listAuditEvents(sessionId)
      .filter((entry) => entry.event.kind === "control.action").length;
    if (controlActionCount < 3) {
      failures.push("Expected at least 3 successful control.action audit events.");
    }

    if (failures.length > 0) {
      fail("wave62 status memory summary surface gate failed.", failures.join("\n"));
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave62-status-memory-summary-surface-gate.json"),
      JSON.stringify(
        {
          gate: "wave62-status-memory-summary-surface-gate",
          sessionId,
          statusBefore,
          clearWorking,
          statusAfter,
          controlActionCount,
        },
        null,
        2,
      ),
      "utf8",
    );

    process.stdout.write("wave62 status memory summary surface gate passed.\n");
  } finally {
    store.close();
  }
}

await runGate();
