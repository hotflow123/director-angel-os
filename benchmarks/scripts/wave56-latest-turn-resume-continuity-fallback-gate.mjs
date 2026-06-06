import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionStore } from "../../packages/sessions/dist/index.js";
import { getBenchmarksPaths, runHotflowCliCommand, runWorkspaceBuild } from "./cli-command.mjs";

function fail(message, details) {
  if (details) {
    process.stderr.write(`${message}\n${details}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

function seedLatestTurnResumeContinuityFallbackSession(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  const turnId = "turn_latest_turn_resume_continuity_fallback_gate";
  const todoItem = {
    id: "todo_latest_turn_resume_continuity_fallback",
    content: "latest turn resume continuity fallback todo",
    status: "todo",
  };

  try {
    store.createSession({
      sessionId,
      metadata: {
        runtime: {
          latestTurn: {
            turnId,
            providerId: "openai-live",
            model: "gpt-5-mini",
            resumeAction: "continue-current-step",
            nextStepIndex: 1,
            lastStepEventType: "step.tools_planned",
          },
        },
      },
    });

    store.appendJournal(sessionId, {
      eventType: "tasks.todo_write",
      payload: {
        items: [todoItem],
      },
      createdAtMs: 100,
    });

    store.createStepCheckpoint(sessionId, {
      turnId,
      stepIndex: 0,
      eventType: "step.model_output",
      state: {
        tasks: {
          items: [todoItem],
        },
      },
      createdAtMs: 120,
    });
  } finally {
    store.close();
  }
}

function readAuditSummary(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const auditEvents = store.listAuditEvents(sessionId);
    const statusActions = auditEvents.filter((entry) => {
      if (entry.event.kind !== "control.action") {
        return false;
      }
      const payload = entry.event.payload;
      return (
        payload &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        payload.action === "status" &&
        payload.ok === true
      );
    }).length;

    return {
      totalAuditEvents: auditEvents.length,
      statusActions,
    };
  } finally {
    store.close();
  }
}

function verifyRun(run, expectedNeedles) {
  const failures = [];
  if (run.status !== 0) {
    failures.push(`Expected CLI exit status 0 but received ${run.status}.`);
  }
  for (const needle of expectedNeedles) {
    if (!run.stdout.includes(needle)) {
      failures.push(`Expected CLI stdout to include: ${needle}`);
    }
  }
  return failures;
}

async function runGate() {
  const { resultsDir } = getBenchmarksPaths();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave56-latest-turn-resume-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(
    dataDir,
    "sessions",
    "wave56-latest-turn-resume-continuity-fallback.sqlite",
  );
  const sessionId = "sess_wave56_latest_turn_resume_continuity_fallback";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "README.md"),
    "Wave 56 latest turn resume continuity fallback benchmark.\n",
    "utf8",
  );

  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
  };

  const sessionsBuild = runWorkspaceBuild("@hotflow/sessions", env);
  if (sessionsBuild.status !== 0) {
    fail(
      "sessions build failed for wave56 latest turn resume continuity fallback gate.",
      sessionsBuild.stderr,
    );
  }

  const controlPlaneBuild = runWorkspaceBuild("@hotflow/control-plane", env);
  if (controlPlaneBuild.status !== 0) {
    fail(
      "control-plane build failed for wave56 latest turn resume continuity fallback gate.",
      controlPlaneBuild.stderr,
    );
  }

  const cliBuild = runWorkspaceBuild("@hotflow/cli", env);
  if (cliBuild.status !== 0) {
    fail(
      "cli build failed for wave56 latest turn resume continuity fallback gate.",
      cliBuild.stderr,
    );
  }

  seedLatestTurnResumeContinuityFallbackSession(sessionDbPath, sessionId);

  const statusRun = runHotflowCliCommand(["status", sessionId], env);
  const failures = verifyRun(statusRun, [
    "Latest turn: turn_latest_turn_resume_continuity_fallback_gate",
    "Latest turn provider: openai-live",
    "Latest turn model: gpt-5-mini",
    "Step recovery:",
    "  Resume action: continue-current-step",
    "  Next step index: 1",
    "  Last step event: step.tools_planned",
  ]);

  const auditSummary = readAuditSummary(sessionDbPath, sessionId);
  if (auditSummary.statusActions < 1) {
    failures.push("Expected at least 1 successful status control.action audit event.");
  }

  if (failures.length > 0) {
    fail("wave56 latest turn resume continuity fallback gate failed.", failures.join("\n"));
  }

  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    join(resultsDir, "wave56-latest-turn-resume-continuity-fallback-gate.json"),
    JSON.stringify(
      {
        gate: "wave56-latest-turn-resume-continuity-fallback-gate",
        sessionId,
        auditSummary,
        statusStdout: statusRun.stdout,
      },
      null,
      2,
    ),
    "utf8",
  );

  process.stdout.write("wave56 latest turn resume continuity fallback gate passed.\n");
}

await runGate();
