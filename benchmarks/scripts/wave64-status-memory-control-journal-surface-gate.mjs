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
    fail(
      `${workspace} build failed for wave64 status memory control journal surface gate.`,
      result.stderr,
    );
  }
}

async function runGate() {
  const { resultsDir } = getBenchmarksPaths();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave64-status-memory-journal-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave64-status-memory-control-journal.sqlite");
  const sessionId = "sess_wave64_status_memory_control_journal";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "README.md"),
    "Wave 64 status memory control journal surface.\n",
  );

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
    const inspectAll = await dispatchOrThrow(controlPlane, {
      type: "memory-inspect",
      sessionId,
      scope: "all",
    });
    const statusAfterInspect = await dispatchOrThrow(controlPlane, {
      type: "status",
      sessionId,
    });
    const clearWorking = await dispatchOrThrow(controlPlane, {
      type: "memory-clear",
      sessionId,
      scope: "working",
    });
    const statusAfterClear = await dispatchOrThrow(controlPlane, {
      type: "status",
      sessionId,
    });

    const failures = [];

    if (statusBefore.latestMemoryControl !== undefined) {
      failures.push(
        "Expected status before any memory control action to omit latestMemoryControl.",
      );
    }
    if (inspectAll.layer0Count !== 2 || inspectAll.layer1Count !== 1) {
      failures.push("Expected memory-inspect to preserve the wave61 inspect contract.");
    }
    if (
      statusAfterInspect.latestMemoryControl?.action !== "inspect" ||
      statusAfterInspect.latestMemoryControl?.scope !== "all" ||
      typeof statusAfterInspect.latestMemoryControl?.journalSeq !== "number" ||
      typeof statusAfterInspect.latestMemoryControl?.occurredAtMs !== "number"
    ) {
      failures.push(
        "Expected status after inspect to surface inspect summary with journal seq and occurredAtMs.",
      );
    }
    if (
      clearWorking.beforeLayer0Count !== 2 ||
      clearWorking.beforeLayer1Count !== 1 ||
      clearWorking.afterLayer0Count !== 0 ||
      clearWorking.afterLayer1Count !== 1
    ) {
      failures.push("Expected memory-clear to preserve the wave61 before/after closure contract.");
    }
    if (
      statusAfterClear.latestMemoryControl?.action !== "clear" ||
      statusAfterClear.latestMemoryControl?.scope !== "working" ||
      typeof statusAfterClear.latestMemoryControl?.journalSeq !== "number" ||
      typeof statusAfterClear.latestMemoryControl?.occurredAtMs !== "number"
    ) {
      failures.push(
        "Expected status after clear to surface clear summary with journal seq and occurredAtMs.",
      );
    }
    if (
      typeof statusAfterInspect.latestMemoryControl?.journalSeq === "number" &&
      typeof statusAfterClear.latestMemoryControl?.journalSeq === "number" &&
      statusAfterClear.latestMemoryControl.journalSeq <=
        statusAfterInspect.latestMemoryControl.journalSeq
    ) {
      failures.push("Expected latest memory control journal seq to advance after clear.");
    }
    if (
      typeof statusAfterInspect.latestMemoryControl?.occurredAtMs === "number" &&
      typeof statusAfterClear.latestMemoryControl?.occurredAtMs === "number" &&
      statusAfterClear.latestMemoryControl.occurredAtMs <
        statusAfterInspect.latestMemoryControl.occurredAtMs
    ) {
      failures.push("Expected latest memory control occurredAtMs to be monotonic.");
    }
    if (
      statusAfterClear.workingMemoryEntries !== 0 ||
      statusAfterClear.episodicMemoryEntries !== 1
    ) {
      failures.push("Expected status after clear to keep the wave62 memory count surface.");
    }

    const controlActionCount = store
      .listAuditEvents(sessionId)
      .filter((entry) => entry.event.kind === "control.action").length;
    if (controlActionCount < 5) {
      failures.push("Expected at least 5 successful control.action audit events.");
    }

    if (failures.length > 0) {
      fail("wave64 status memory control journal surface gate failed.", failures.join("\n"));
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave64-status-memory-control-journal-surface-gate.json"),
      JSON.stringify(
        {
          gate: "wave64-status-memory-control-journal-surface-gate",
          sessionId,
          statusBefore,
          inspectAll,
          statusAfterInspect,
          clearWorking,
          statusAfterClear,
          controlActionCount,
        },
        null,
        2,
      ),
      "utf8",
    );

    process.stdout.write("wave64 status memory control journal surface gate passed.\n");
  } finally {
    store.close();
  }
}

await runGate();
