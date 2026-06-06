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
      `${target} build failed for wave87 status prompt change summary closure gate.`,
      result.stderr,
    );
  }
}

function seedSession(sessionDbPath, sessionId, workspaceRoot) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const turnId = "turn_wave87_status_prompt_change_summary";
    store.createSession({
      sessionId,
      metadata: {
        runtime: {
          latestTurn: {
            turnId,
            providerId: "openai-live",
            model: "gpt-5-mini",
          },
        },
      },
    });

    store.appendJournal(sessionId, {
      eventType: "tasks.todo_write",
      payload: {
        items: [{ id: "todo_wave87", content: "status prompt change summary", status: "todo" }],
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
        omittedSections: [
          { id: "working-memory.recall-1", cacheBucket: "dynamic", owner: "memory" },
        ],
        omittedSectionIds: ["working-memory.recall-1"],
        usedTokens: 480,
        remainingTokens: 1520,
        runtimeDegradations: [],
      },
      createdAtMs: 120,
    });

    store.appendStepJournal(sessionId, {
      turnId,
      stepIndex: 1,
      eventType: "step.context_built",
      payload: {
        staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
        staticSectionIds: ["system.identity"],
        dynamicSections: [
          { id: "tool-results", cacheBucket: "dynamic", owner: "turn", priority: 80 },
          { id: "session.guidance", cacheBucket: "dynamic", owner: "runtime" },
          { id: "runtime.tool-status", cacheBucket: "dynamic", owner: "runtime" },
        ],
        dynamicSectionIds: ["tool-results", "session.guidance", "runtime.tool-status"],
        omittedSections: [{ id: "runtime.degradations", cacheBucket: "dynamic", owner: "runtime" }],
        omittedSectionIds: ["runtime.degradations"],
        usedTokens: 620,
        remainingTokens: 1380,
        runtimeDegradations: [
          {
            stage: "context",
            category: "budget",
            severity: "warn",
            reason: "token_budget_low",
            message: "Prompt recall sections were trimmed by budget.",
          },
        ],
      },
      createdAtMs: 200,
    });

    store.appendStepJournal(sessionId, {
      turnId,
      stepIndex: 1,
      eventType: "step.tool_result",
      payload: {
        results: [{ toolName: "tasks.todo_write", resolution: "executed", ok: true }],
      },
      createdAtMs: 260,
    });

    writeFileSync(
      join(workspaceRoot, "README.md"),
      "Wave 87 status prompt change summary closure.\n",
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
      statusControlActions: auditEvents.filter((entry) => {
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
  const { resultsDir, repoRoot } = getBenchmarksPaths();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave87-status-prompt-change-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(
    dataDir,
    "sessions",
    "wave87-status-prompt-change-summary-closure.sqlite",
  );
  const sessionId = "sess_wave87_status_prompt_change_summary";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });

  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
    HOTFLOW_OUTPUT_STYLE: "normal",
    HOTFLOW_PERMISSION_MODE: "ask",
    HOTFLOW_RESPONSE_LANGUAGE: "zh-CN",
  };

  buildWorkspace("@hotflow/sessions", env);
  buildWorkspace("@hotflow/control-plane", env);
  buildWorkspace("@hotflow/cli", env);

  try {
    seedSession(sessionDbPath, sessionId, workspaceRoot);

    const statusRun = runHotflowCliCommand(["status", sessionId], env);

    const failures = verifyRun(statusRun, [
      "Latest prompt step: 1 (prev 0)",
      "Prompt focus: tool results, session guidance, tool runtime guidance",
      "Prompt omissions: runtime degradations",
      "Prompt changes: +tool results +tool runtime guidance -user input omit:+runtime degradations restore:working memory recall 1",
    ]);

    const auditSummary = readAuditSummary(sessionDbPath, sessionId);
    if (auditSummary.statusControlActions < 1) {
      failures.push("Expected at least 1 successful status control.action audit event.");
    }
    if (auditSummary.statusCliCompletions < 1) {
      failures.push("Expected at least 1 cli.status.completed audit event.");
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave87-status-prompt-change-summary-closure-gate.json"),
      JSON.stringify(
        {
          gate: "wave87-status-prompt-change-summary-closure-gate",
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
      fail("wave87 status prompt change summary closure gate failed.", failures.join("\n"));
    }

    process.stdout.write("wave87 status prompt change summary closure gate passed.\n");
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

await runGate();
