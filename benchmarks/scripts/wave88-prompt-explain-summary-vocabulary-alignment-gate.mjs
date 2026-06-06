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
      `${target} build failed for wave88 prompt-explain summary vocabulary alignment gate.`,
      result.stderr,
    );
  }
}

function seedSession(sessionDbPath, sessionId, workspaceRoot) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const turnId = "turn_wave88_prompt_explain_summary_vocabulary";
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
      createdAtMs: 100,
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
        ],
        dynamicSectionIds: ["tool-results", "session.guidance"],
        omittedSections: [{ id: "runtime.degradations", cacheBucket: "dynamic", owner: "runtime" }],
        omittedSectionIds: ["runtime.degradations"],
        usedTokens: 620,
        remainingTokens: 1380,
        runtimeDegradations: [
          {
            stage: "context",
            category: "budget",
            action: "degrade",
            severity: "warn",
            reason: "token_budget_low",
            message: "Prompt recall sections were trimmed by budget.",
            recoverable: true,
          },
        ],
      },
      createdAtMs: 200,
    });

    writeFileSync(
      join(workspaceRoot, "README.md"),
      "Wave 88 prompt-explain summary vocabulary alignment.\n",
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
      promptExplainActions: auditEvents.filter((entry) => {
        if (entry.event.kind !== "control.action") {
          return false;
        }

        const payload = entry.event.payload;
        return (
          payload &&
          typeof payload === "object" &&
          !Array.isArray(payload) &&
          payload.action === "prompt-explain" &&
          payload.ok === true
        );
      }).length,
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
      failures.push(`Expected CLI stdout to exclude legacy wording: ${needle}`);
    }
  }
  return failures;
}

async function runGate() {
  const { resultsDir, repoRoot } = getBenchmarksPaths();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave88-prompt-explain-summary-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(
    dataDir,
    "sessions",
    "wave88-prompt-explain-summary-vocabulary.sqlite",
  );
  const sessionId = "sess_wave88_prompt_explain_summary_vocabulary";

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

    const latestRun = runHotflowCliCommand(["control", "prompt-explain", sessionId], env);
    const explicitRun = runHotflowCliCommand(
      [
        "control",
        "prompt-explain",
        sessionId,
        "--turn",
        "turn_wave88_prompt_explain_summary_vocabulary",
        "--step",
        "0",
      ],
      env,
    );

    const failures = [
      ...verifyRun(
        latestRun,
        [
          "Control action: prompt-explain",
          "Prompt tokens: used=620 remaining=1380",
          "Prompt focus: tool results, session guidance",
          "Prompt omissions: runtime degradations",
          "Runtime degradations: 1",
        ],
        [
          "Token budget:",
          "Current focus:",
          "Current omissions:",
          "Runtime degradations affecting prompt:",
        ],
      ),
      ...verifyRun(
        explicitRun,
        [
          "Control action: prompt-explain",
          "Prompt tokens: used=480 remaining=1520",
          "Prompt focus: user input, session guidance",
          "Prompt omissions: working memory recall 1",
        ],
        ["Token budget:", "Current focus:", "Current omissions:"],
      ),
    ];

    const auditSummary = readAuditSummary(sessionDbPath, sessionId);
    if (auditSummary.promptExplainActions < 2) {
      failures.push("Expected at least 2 successful prompt-explain control.action audit events.");
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave88-prompt-explain-summary-vocabulary-alignment-gate.json"),
      JSON.stringify(
        {
          gate: "wave88-prompt-explain-summary-vocabulary-alignment-gate",
          workspaceRoot,
          repoRoot,
          runs: {
            latest: latestRun,
            explicit: explicitRun,
          },
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
      fail("wave88 prompt-explain summary vocabulary alignment gate failed.", failures.join("\n"));
    }

    process.stdout.write("wave88 prompt-explain summary vocabulary alignment gate passed.\n");
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

await runGate();
