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

function seedLatestTurnPromptDegradationFallbackSession(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  const turnId = "turn_latest_turn_prompt_degradation_fallback_gate";
  const todoItem = {
    id: "todo_latest_turn_prompt_degradation_fallback",
    content: "latest turn prompt degradation fallback todo",
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
            runtimeDegradationSummaries: [
              "budget trim [warn]",
              "tool replay trim (filesystem.read_text) [warn]",
            ],
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
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave55-latest-turn-prompt-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(
    dataDir,
    "sessions",
    "wave55-latest-turn-prompt-degradation-fallback.sqlite",
  );
  const sessionId = "sess_wave55_latest_turn_prompt_degradation_fallback";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "README.md"),
    "Wave 55 latest turn prompt degradation fallback benchmark.\n",
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
      "sessions build failed for wave55 latest turn prompt degradation fallback gate.",
      sessionsBuild.stderr,
    );
  }

  const controlPlaneBuild = runWorkspaceBuild("@hotflow/control-plane", env);
  if (controlPlaneBuild.status !== 0) {
    fail(
      "control-plane build failed for wave55 latest turn prompt degradation fallback gate.",
      controlPlaneBuild.stderr,
    );
  }

  const cliBuild = runWorkspaceBuild("@hotflow/cli", env);
  if (cliBuild.status !== 0) {
    fail(
      "cli build failed for wave55 latest turn prompt degradation fallback gate.",
      cliBuild.stderr,
    );
  }

  seedLatestTurnPromptDegradationFallbackSession(sessionDbPath, sessionId);

  const statusRun = runHotflowCliCommand(["status", sessionId], env);
  const failures = verifyRun(statusRun, [
    "Latest turn: turn_latest_turn_prompt_degradation_fallback_gate",
    "Latest turn provider: openai-live",
    "Latest turn model: gpt-5-mini",
    "Latest turn prompt degradations: budget trim [warn]; tool replay trim (filesystem.read_text) [warn]",
  ]);

  const auditSummary = readAuditSummary(sessionDbPath, sessionId);
  if (auditSummary.statusActions < 1) {
    failures.push("Expected at least 1 successful status control.action audit event.");
  }

  if (failures.length > 0) {
    fail("wave55 latest turn prompt degradation fallback gate failed.", failures.join("\n"));
  }

  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    join(resultsDir, "wave55-latest-turn-prompt-degradation-fallback-gate.json"),
    JSON.stringify(
      {
        gate: "wave55-latest-turn-prompt-degradation-fallback-gate",
        sessionId,
        auditSummary,
        statusStdout: statusRun.stdout,
      },
      null,
      2,
    ),
    "utf8",
  );

  process.stdout.write("wave55 latest turn prompt degradation fallback gate passed.\n");
}

await runGate();
