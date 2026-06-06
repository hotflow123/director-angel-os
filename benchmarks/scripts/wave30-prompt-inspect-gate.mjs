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

function seedPromptInspectSession(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    store.createSession({
      sessionId,
      metadata: {
        runtime: {
          latestTurn: {
            turnId: "turn_prompt_gate",
            providerId: "openai-live",
            model: "gpt-5-mini",
          },
        },
      },
    });

    store.appendStepJournal(sessionId, {
      turnId: "turn_prompt_gate",
      stepIndex: 0,
      eventType: "step.context_built",
      payload: {
        staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
        staticSectionIds: ["system.identity"],
        dynamicSections: [{ id: "user-input", cacheBucket: "dynamic", owner: "turn" }],
        dynamicSectionIds: ["user-input"],
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
      turnId: "turn_prompt_gate",
      stepIndex: 1,
      eventType: "step.context_built",
      payload: {
        staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
        staticSectionIds: ["system.identity"],
        dynamicSections: [
          {
            id: "tool-results",
            cacheBucket: "dynamic",
            owner: "turn",
            priority: 80,
          },
        ],
        dynamicSectionIds: ["tool-results"],
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

function readPromptInspectAuditSummary(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const auditEvents = store.listAuditEvents(sessionId);
    const promptInspectActions = auditEvents.filter((entry) => {
      if (entry.event.kind !== "control.action") {
        return false;
      }
      const payload = entry.event.payload;
      return (
        payload &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        payload.action === "prompt-inspect" &&
        payload.ok === true
      );
    });

    return {
      totalAuditEvents: auditEvents.length,
      promptInspectAuditEvents: promptInspectActions.length,
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
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave30-prompt-inspect-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave30-prompt-inspect.sqlite");
  const sessionId = "sess_wave30_prompt_inspect";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(join(workspaceRoot, "README.md"), "Wave 30 prompt inspect benchmark.\n", "utf8");

  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
  };

  const sessionsBuild = runWorkspaceBuild("@hotflow/sessions", env);
  if (sessionsBuild.status !== 0) {
    fail("sessions build failed for wave30 prompt inspect gate.", sessionsBuild.stderr);
  }

  const controlPlaneBuild = runWorkspaceBuild("@hotflow/control-plane", env);
  if (controlPlaneBuild.status !== 0) {
    fail("control-plane build failed for wave30 prompt inspect gate.", controlPlaneBuild.stderr);
  }

  const cliBuild = runWorkspaceBuild("@hotflow/cli", env);
  if (cliBuild.status !== 0) {
    fail("cli build failed for wave30 prompt inspect gate.", cliBuild.stderr);
  }

  try {
    seedPromptInspectSession(sessionDbPath, sessionId);

    const latestRun = runHotflowCliCommand(["control", "prompt-inspect", sessionId], env);
    const explicitRun = runHotflowCliCommand(
      ["control", "prompt-inspect", sessionId, "--turn", "turn_prompt_gate", "--step", "0"],
      env,
    );

    const failures = [
      ...verifyRun(latestRun, [
        "Control action: prompt-inspect",
        "Turn: turn_prompt_gate",
        "Step index: 1",
        "Available prompt steps: 0, 1",
        "tool-results cache=dynamic owner=turn priority=80",
        "Runtime degradations: 1",
      ]),
      ...verifyRun(explicitRun, [
        "Control action: prompt-inspect",
        "Step index: 0",
        "Prompt degradations: (none)",
        "Runtime degradations: (none)",
        "user-input cache=dynamic owner=turn",
        "working-memory.recall-1 cache=dynamic owner=memory",
      ]),
    ];

    const auditSummary = readPromptInspectAuditSummary(sessionDbPath, sessionId);
    if (auditSummary.promptInspectAuditEvents < 2) {
      failures.push(
        `Expected at least 2 prompt-inspect audit events but found ${auditSummary.promptInspectAuditEvents}.`,
      );
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave30-prompt-inspect-gate-latest.json"),
      JSON.stringify(
        {
          gate: "wave30-prompt-inspect",
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
      fail("wave30 prompt inspect gate failed.", failures.join("\n"));
    }
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }

  process.stdout.write("wave30 prompt inspect gate passed.\n");
}

await runGate();
