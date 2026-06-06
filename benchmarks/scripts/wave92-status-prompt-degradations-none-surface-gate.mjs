import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

function buildWorkspace(target, env) {
  const result = runWorkspaceBuild(target, env);
  if (result.status !== 0) {
    fail(
      `${target} build failed for wave92 status prompt degradations none surface gate.`,
      result.stderr,
    );
  }
}

function seedSession(sessionDbPath, sessionId, workspaceRoot) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const turnId = "turn_wave92_status_prompt_degradations_none";
    store.createSession({
      sessionId,
      metadata: {
        runtime: {
          latestTurn: {
            turnId,
            providerId: "openai-live",
            model: "gpt-5-mini",
            runtimeDegradationSummaries: ["budget trim [warn]"],
          },
        },
      },
    });

    store.appendJournal(sessionId, {
      eventType: "tasks.todo_write",
      payload: {
        items: [{ id: "todo_wave92", content: "status prompt degradations none", status: "todo" }],
      },
      createdAtMs: 100,
    });

    store.appendStepJournal(sessionId, {
      turnId,
      stepIndex: 0,
      eventType: "step.context_built",
      payload: {
        staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
        staticSectionIds: ["system.identity"],
        dynamicSections: [
          { id: "user-input", cacheBucket: "dynamic", owner: "turn" },
          { id: "session.guidance", cacheBucket: "dynamic", owner: "runtime" },
        ],
        dynamicSectionIds: ["user-input", "session.guidance"],
        omittedSections: [],
        omittedSectionIds: [],
        usedTokens: 500,
        remainingTokens: 1500,
        runtimeDegradations: [],
      },
      createdAtMs: 120,
    });

    writeFileSync(
      join(workspaceRoot, "README.md"),
      "Wave 92 status prompt degradations none surface.\n",
      "utf8",
    );
  } finally {
    store.close();
  }
}

function readAuditSummary(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const auditEvents = store.listAuditEvents(sessionId);
    return {
      totalAuditEvents: auditEvents.length,
      statusActions: auditEvents.filter((entry) => {
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
      }).length,
      statusCliCompletions: auditEvents.filter(
        (entry) => entry.event.kind === "cli.status.completed",
      ).length,
    };
  } finally {
    store.close();
  }
}

function verifyRun(run, expectedNeedles, forbiddenNeedles = []) {
  const failures = [];
  if (run.status !== 0) {
    failures.push(`Expected CLI exit status 0 but received ${run.status}.`);
  }
  for (const needle of expectedNeedles) {
    if (!run.stdout.includes(needle)) {
      failures.push(`Expected CLI stdout to include: ${needle}`);
    }
  }
  for (const needle of forbiddenNeedles) {
    if (run.stdout.includes(needle)) {
      failures.push(`Expected CLI stdout to exclude: ${needle}`);
    }
  }
  return failures;
}

async function runGate() {
  const { resultsDir, repoRoot } = getBenchmarksPaths();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave92-status-prompt-degradations-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(
    dataDir,
    "sessions",
    "wave92-status-prompt-degradations-none-surface.sqlite",
  );
  const sessionId = "sess_wave92_status_prompt_degradations_none";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });

  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
  };

  buildWorkspace("@hotflow/sessions", env);
  buildWorkspace("@hotflow/control-plane", env);
  buildWorkspace("@hotflow/cli", env);

  try {
    seedSession(sessionDbPath, sessionId, workspaceRoot);

    const statusRun = runHotflowCliCommand(["status", sessionId], env);

    const failures = verifyRun(
      statusRun,
      [
        "Latest turn: turn_wave92_status_prompt_degradations_none",
        "Latest prompt step: 0 (first prompt build in the turn)",
        "Prompt focus: user input, session guidance",
        "Prompt omissions: (none)",
        "Prompt degradations: (none)",
        "Prompt changes: first prompt build in the turn",
      ],
      ["Latest turn prompt degradations:"],
    );

    const auditSummary = readAuditSummary(sessionDbPath, sessionId);
    if (auditSummary.statusActions < 1) {
      failures.push("Expected at least 1 successful status control.action audit event.");
    }
    if (auditSummary.statusCliCompletions < 1) {
      failures.push("Expected at least 1 cli.status.completed audit event.");
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave92-status-prompt-degradations-none-surface-gate.json"),
      JSON.stringify(
        {
          gate: "wave92-status-prompt-degradations-none-surface-gate",
          workspaceRoot,
          repoRoot,
          statusRun,
          auditSummary,
          passed: failures.length === 0,
          failures,
        },
        null,
        2,
      ),
      "utf8",
    );

    if (failures.length > 0) {
      fail("wave92 status prompt degradations none surface gate failed.", failures.join("\n"));
    }

    process.stdout.write("wave92 status prompt degradations none surface gate passed.\n");
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

await runGate();
