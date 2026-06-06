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

function createReplayTrimDegradation() {
  return {
    stage: "runtime",
    category: "runtime",
    action: "degrade",
    severity: "minor",
    reason: "context-pressure",
    message:
      'Tool result replay for "filesystem.read_text" was truncated to fit the remaining context budget.',
    recoverable: true,
    metadata: {
      toolCallId: "call-1",
      toolName: "filesystem.read_text",
      replayChars: 512,
      originalChars: 4096,
    },
  };
}

function seedReplayDegradationSummarySession(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  const degradation = createReplayTrimDegradation();

  try {
    store.createSession({
      sessionId,
      metadata: {
        runtime: {
          latestTurn: {
            turnId: "turn_prompt_replay_operator_gate",
            providerId: "openai-live",
            model: "gpt-5-mini",
          },
        },
      },
    });

    store.appendJournal(sessionId, {
      eventType: "tasks.todo_write",
      payload: {
        items: [{ id: "todo_replay_trim", content: "replay trim status todo", status: "todo" }],
      },
      createdAtMs: 100,
    });

    store.appendStepJournal(sessionId, {
      turnId: "turn_prompt_replay_operator_gate",
      stepIndex: 0,
      eventType: "step.context_built",
      payload: {
        staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
        staticSectionIds: ["system.identity"],
        dynamicSections: [{ id: "user-input", cacheBucket: "dynamic", owner: "turn" }],
        dynamicSectionIds: ["user-input"],
        omittedSections: [],
        omittedSectionIds: [],
        usedTokens: 420,
        remainingTokens: 1580,
        runtimeDegradations: [],
      },
      createdAtMs: 200,
    });

    store.appendStepJournal(sessionId, {
      turnId: "turn_prompt_replay_operator_gate",
      stepIndex: 1,
      eventType: "step.context_built",
      payload: {
        staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
        staticSectionIds: ["system.identity"],
        dynamicSections: [
          { id: "tool-results", cacheBucket: "dynamic", owner: "turn", priority: 80 },
          {
            id: "session.guidance",
            cacheBucket: "dynamic",
            owner: "runtime",
            metadataKeys: ["outputStyle"],
            metadataPreview: {
              outputStyle: "concise",
            },
          },
        ],
        dynamicSectionIds: ["tool-results", "session.guidance"],
        omittedSections: [{ id: "runtime.degradations", cacheBucket: "dynamic", owner: "runtime" }],
        omittedSectionIds: ["runtime.degradations"],
        usedTokens: 610,
        remainingTokens: 1390,
        runtimeDegradations: [degradation],
      },
      createdAtMs: 300,
    });

    store.recordRuntimeEvidence(sessionId, {
      turnId: "turn_prompt_replay_operator_gate",
      kind: "runtime.degraded",
      payload: degradation,
      createdAt: "2026-04-17T00:00:00.000Z",
    });
  } finally {
    store.close();
  }
}

function readAuditSummary(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const auditEvents = store.listAuditEvents(sessionId);
    const statusControlActions = auditEvents.filter((entry) => {
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
    const promptExplainControlActions = auditEvents.filter((entry) => {
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
    }).length;

    return {
      totalAuditEvents: auditEvents.length,
      statusControlActions,
      promptExplainControlActions,
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
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave49-replay-operator-summary-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave49-replay-operator-summary.sqlite");
  const sessionId = "sess_wave49_replay_operator_summary";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "README.md"),
    "Wave 49 replay degradation operator summary benchmark.\n",
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
      "sessions build failed for wave49 replay degradation operator summary gate.",
      sessionsBuild.stderr,
    );
  }

  const controlPlaneBuild = runWorkspaceBuild("@hotflow/control-plane", env);
  if (controlPlaneBuild.status !== 0) {
    fail(
      "control-plane build failed for wave49 replay degradation operator summary gate.",
      controlPlaneBuild.stderr,
    );
  }

  const cliBuild = runWorkspaceBuild("@hotflow/cli", env);
  if (cliBuild.status !== 0) {
    fail("cli build failed for wave49 replay degradation operator summary gate.", cliBuild.stderr);
  }

  try {
    seedReplayDegradationSummarySession(sessionDbPath, sessionId);

    const explainRun = runHotflowCliCommand(
      ["control", "prompt-explain", sessionId, "--turn", "turn_prompt_replay_operator_gate"],
      env,
    );
    const statusRun = runHotflowCliCommand(["status", sessionId], env);

    const failures = [
      ...verifyRun(explainRun, [
        "Control action: prompt-explain",
        "Prompt degradations: tool replay trim (filesystem.read_text) [minor]",
        "Runtime degradations: 1",
        "reason=context-pressure",
      ]),
      ...verifyRun(statusRun, [
        "Step recovery:",
        "Runtime status: degraded",
        "Prompt degradations: tool replay trim (filesystem.read_text) [minor]",
      ]),
    ];

    const auditSummary = readAuditSummary(sessionDbPath, sessionId);
    if (auditSummary.promptExplainControlActions < 1) {
      failures.push("Expected at least 1 successful prompt-explain control.action audit event.");
    }
    if (auditSummary.statusControlActions < 1) {
      failures.push("Expected at least 1 successful status control.action audit event.");
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave49-replay-degradation-operator-summary-gate-latest.json"),
      JSON.stringify(
        {
          gate: "wave49-replay-degradation-operator-summary",
          workspaceRoot,
          repoRoot,
          runs: {
            explain: explainRun,
            status: statusRun,
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
      fail("wave49 replay degradation operator summary gate failed.", failures.join("\n"));
    }
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }

  process.stdout.write("wave49 replay degradation operator summary gate passed.\n");
}

await runGate();
