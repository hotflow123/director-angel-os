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

function seedPromptExplainSession(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    store.createSession({
      sessionId,
      metadata: {
        runtime: {
          latestTurn: {
            turnId: "turn_prompt_explain_gate",
            providerId: "openai-live",
            model: "gpt-5-mini",
          },
        },
      },
    });

    store.appendStepJournal(sessionId, {
      turnId: "turn_prompt_explain_gate",
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
      turnId: "turn_prompt_explain_gate",
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
  } finally {
    store.close();
  }
}

function readPromptExplainAuditSummary(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const auditEvents = store.listAuditEvents(sessionId);
    const promptExplainActions = auditEvents.filter((entry) => {
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
    });

    return {
      totalAuditEvents: auditEvents.length,
      promptExplainAuditEvents: promptExplainActions.length,
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
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave31-prompt-explain-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave31-prompt-explain.sqlite");
  const sessionId = "sess_wave31_prompt_explain";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(join(workspaceRoot, "README.md"), "Wave 31 prompt explain benchmark.\n", "utf8");

  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
  };

  const sessionsBuild = runWorkspaceBuild("@hotflow/sessions", env);
  if (sessionsBuild.status !== 0) {
    fail("sessions build failed for wave31 prompt explain gate.", sessionsBuild.stderr);
  }

  const controlPlaneBuild = runWorkspaceBuild("@hotflow/control-plane", env);
  if (controlPlaneBuild.status !== 0) {
    fail("control-plane build failed for wave31 prompt explain gate.", controlPlaneBuild.stderr);
  }

  const cliBuild = runWorkspaceBuild("@hotflow/cli", env);
  if (cliBuild.status !== 0) {
    fail("cli build failed for wave31 prompt explain gate.", cliBuild.stderr);
  }

  try {
    seedPromptExplainSession(sessionDbPath, sessionId);

    const latestRun = runHotflowCliCommand(["control", "prompt-explain", sessionId], env);
    const explicitRun = runHotflowCliCommand(
      ["control", "prompt-explain", sessionId, "--turn", "turn_prompt_explain_gate", "--step", "0"],
      env,
    );

    const failures = [
      ...verifyRun(latestRun, [
        "Control action: prompt-explain",
        "Step index: 1",
        "Previous prompt step: 0",
        "Prompt tokens: used=620 remaining=1380",
        "Prompt focus: tool results, session guidance",
        "Added dynamic sections: tool results",
        "Removed dynamic sections: user input",
        "Restored omitted sections: working memory recall 1",
      ]),
      ...verifyRun(explicitRun, [
        "Control action: prompt-explain",
        "Step index: 0",
        "Prompt tokens: used=480 remaining=1520",
        "Prompt focus: user input, session guidance",
        "Prompt degradations: (none)",
        "Change since previous prompt build: this is the first prompt build in the turn.",
      ]),
    ];

    const auditSummary = readPromptExplainAuditSummary(sessionDbPath, sessionId);
    if (auditSummary.promptExplainAuditEvents < 2) {
      failures.push(
        `Expected at least 2 prompt-explain audit events but found ${auditSummary.promptExplainAuditEvents}.`,
      );
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave31-prompt-explain-gate-latest.json"),
      JSON.stringify(
        {
          gate: "wave31-prompt-explain",
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
      fail("wave31 prompt explain gate failed.", failures.join("\n"));
    }
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }

  process.stdout.write("wave31 prompt explain gate passed.\n");
}

await runGate();
