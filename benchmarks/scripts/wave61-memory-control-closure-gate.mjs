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
    fail(`${workspace} build failed for wave61 memory control closure gate.`, result.stderr);
  }
}

function sameIds(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    [...actual].sort().join("\n") === [...expected].sort().join("\n")
  );
}

async function runGate() {
  const { resultsDir } = getBenchmarksPaths();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave61-memory-control-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave61-memory-control-closure.sqlite");
  const sessionId = "sess_wave61_memory_control_closure";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(join(workspaceRoot, "README.md"), "Wave 61 memory control closure.\n");

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
    const workingA = memory.writeLayer0({
      content: "working-note-a",
      scope: { sessionId },
    });
    const workingB = memory.writeLayer0({
      content: "working-note-b",
      scope: { sessionId },
    });
    const episodic = memory.writeLayer1({
      content: "episodic-note-a",
      scope: { sessionId },
    });

    const controlPlane = createCliControlPlane({
      sessionStore: store,
      memory,
      recordAuditEvent(input) {
        recordCliAuditEvent(store, input);
      },
    });

    const inspectBefore = await dispatchOrThrow(controlPlane, {
      type: "memory-inspect",
      sessionId,
      scope: "all",
    });
    const clearWorking = await dispatchOrThrow(controlPlane, {
      type: "memory-clear",
      sessionId,
      scope: "working",
    });
    const inspectAfter = await dispatchOrThrow(controlPlane, {
      type: "memory-inspect",
      sessionId,
      scope: "all",
    });

    const journalEntries = store.journal.list(sessionId);
    const inspectEvents = journalEntries.filter(
      (entry) => entry.eventType === "control.memory_inspect",
    );
    const clearEvent = journalEntries.find((entry) => entry.eventType === "control.memory_clear");
    const controlActionCount = store
      .listAuditEvents(sessionId)
      .filter((entry) => entry.event.kind === "control.action").length;

    const failures = [];

    if (inspectBefore.layer0Count !== 2 || inspectBefore.layer1Count !== 1) {
      failures.push(
        "Expected first memory-inspect to report 2 working entries and 1 episodic entry.",
      );
    }
    if (
      !sameIds(inspectBefore.layer0Ids, [workingA.id, workingB.id]) ||
      !sameIds(inspectBefore.layer1Ids, [episodic.id])
    ) {
      failures.push("Expected first memory-inspect to expose the seeded working and episodic ids.");
    }
    if (
      clearWorking.beforeLayer0Count !== 2 ||
      clearWorking.beforeLayer1Count !== 1 ||
      clearWorking.layer0Cleared !== 2 ||
      clearWorking.layer1Cleared !== 0 ||
      clearWorking.afterLayer0Count !== 0 ||
      clearWorking.afterLayer1Count !== 1
    ) {
      failures.push(
        "Expected memory-clear to report working-memory before/after closure without touching episodic memory.",
      );
    }
    if (!sameIds(clearWorking.layer0Ids, [workingA.id, workingB.id])) {
      failures.push("Expected memory-clear to report the cleared working memory ids.");
    }
    if (
      inspectAfter.layer0Count !== 0 ||
      inspectAfter.layer1Count !== 1 ||
      !sameIds(inspectAfter.layer1Ids, [episodic.id])
    ) {
      failures.push("Expected second memory-inspect to confirm only episodic memory remains.");
    }
    if (inspectEvents.length !== 2) {
      failures.push(
        `Expected 2 control.memory_inspect journal events but received ${inspectEvents.length}.`,
      );
    }
    if (!clearEvent) {
      failures.push("Expected control.memory_clear journal evidence to be written.");
    } else {
      const payload = clearEvent.payload ?? {};
      if (
        payload.beforeLayer0Count !== 2 ||
        payload.beforeLayer1Count !== 1 ||
        payload.layer0Cleared !== 2 ||
        payload.layer1Cleared !== 0 ||
        payload.afterLayer0Count !== 0 ||
        payload.afterLayer1Count !== 1
      ) {
        failures.push(
          "Expected control.memory_clear journal payload to preserve before/after counts.",
        );
      }
    }
    if (controlActionCount < 3) {
      failures.push("Expected at least 3 successful control.action audit events.");
    }

    if (failures.length > 0) {
      fail("wave61 memory control closure gate failed.", failures.join("\n"));
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave61-memory-control-closure-gate.json"),
      JSON.stringify(
        {
          gate: "wave61-memory-control-closure-gate",
          sessionId,
          inspectBefore,
          clearWorking,
          inspectAfter,
          inspectEventCount: inspectEvents.length,
          clearEvent,
          controlActionCount,
        },
        null,
        2,
      ),
      "utf8",
    );

    process.stdout.write("wave61 memory control closure gate passed.\n");
  } finally {
    store.close();
  }
}

await runGate();
