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
      `${target} build failed for wave90 prompt-inspect runtime degradations none surface gate.`,
      result.stderr,
    );
  }
}

function seedSession(sessionDbPath, sessionId, workspaceRoot) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const turnId = "turn_wave90_prompt_inspect_runtime_degradations_none";
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
        omittedSections: [],
        omittedSectionIds: [],
        usedTokens: 500,
        remainingTokens: 1500,
        runtimeDegradations: [],
      },
      createdAtMs: 100,
    });

    writeFileSync(
      join(workspaceRoot, "README.md"),
      "Wave 90 prompt-inspect runtime degradations none surface.\n",
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
      promptInspectActions: auditEvents.filter((entry) => {
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
      }).length,
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
  const workspaceRoot = mkdtempSync(
    join(tmpdir(), "hotflow-wave90-prompt-inspect-runtime-degradations-none-"),
  );
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(
    dataDir,
    "sessions",
    "wave90-prompt-inspect-runtime-degradations-none-surface.sqlite",
  );
  const sessionId = "sess_wave90_prompt_inspect_runtime_degradations_none";

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

    const promptInspectRun = runHotflowCliCommand(
      [
        "control",
        "prompt-inspect",
        sessionId,
        "--turn",
        "turn_wave90_prompt_inspect_runtime_degradations_none",
        "--step",
        "0",
      ],
      env,
    );

    const failures = verifyRun(promptInspectRun, [
      "Control action: prompt-inspect",
      "Step index: 0",
      "Prompt focus: user input, session guidance",
      "Prompt omissions: (none)",
      "Runtime degradations: (none)",
    ]);

    const auditSummary = readAuditSummary(sessionDbPath, sessionId);
    if (auditSummary.promptInspectActions < 1) {
      failures.push("Expected at least 1 successful prompt-inspect control.action audit event.");
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave90-prompt-inspect-runtime-degradations-none-surface-gate.json"),
      JSON.stringify(
        {
          gate: "wave90-prompt-inspect-runtime-degradations-none-surface-gate",
          workspaceRoot,
          repoRoot,
          promptInspectRun,
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
      fail(
        "wave90 prompt-inspect runtime degradations none surface gate failed.",
        failures.join("\n"),
      );
    }

    process.stdout.write("wave90 prompt-inspect runtime degradations none surface gate passed.\n");
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

await runGate();
