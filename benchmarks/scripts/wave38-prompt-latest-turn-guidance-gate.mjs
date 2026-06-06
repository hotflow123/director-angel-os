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

function seedPromptLatestTurnGuidanceSession(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    store.createSession({
      sessionId,
      metadata: {
        runtime: {
          latestTurn: {
            turnId: "turn_prompt_latest_turn_guidance_gate",
            providerId: "openai-live",
            model: "gpt-5-mini",
          },
        },
      },
    });

    store.appendJournal(sessionId, {
      eventType: "tasks.todo_write",
      payload: {
        items: [{ id: "todo_latest_turn", content: "latest turn prompt todo", status: "todo" }],
      },
      createdAtMs: 100,
    });

    store.appendStepJournal(sessionId, {
      turnId: "turn_prompt_latest_turn_guidance_gate",
      stepIndex: 0,
      eventType: "step.context_built",
      payload: {
        staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
        staticSectionIds: ["system.identity"],
        dynamicSections: [{ id: "user-input", cacheBucket: "dynamic", owner: "turn" }],
        dynamicSectionIds: ["user-input"],
        omittedSections: [],
        omittedSectionIds: [],
        usedTokens: 480,
        remainingTokens: 1520,
        runtimeDegradations: [],
      },
      createdAtMs: 200,
    });

    store.appendStepJournal(sessionId, {
      turnId: "turn_prompt_latest_turn_guidance_gate",
      stepIndex: 1,
      eventType: "step.context_built",
      payload: {
        staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
        staticSectionIds: ["system.identity"],
        dynamicSections: [
          { id: "tool-results", cacheBucket: "dynamic", owner: "turn", priority: 80 },
          {
            id: "session.latest-turn",
            cacheBucket: "dynamic",
            owner: "runtime",
            metadataKeys: ["turnId", "runtimeStatus", "turnBranch"],
            metadataPreview: {
              turnId: "turn_previous",
              runtimeStatus: "blocked",
              turnBranch: "approval-required",
            },
          },
        ],
        dynamicSectionIds: ["tool-results", "session.latest-turn"],
        omittedSections: [],
        omittedSectionIds: [],
        usedTokens: 640,
        remainingTokens: 1360,
        runtimeDegradations: [],
      },
      createdAtMs: 300,
    });

    store.appendStepJournal(sessionId, {
      turnId: "turn_prompt_latest_turn_guidance_gate",
      stepIndex: 1,
      eventType: "step.tool_result",
      payload: {
        results: [{ toolName: "tasks.todo_write", resolution: "executed", ok: true }],
      },
      createdAtMs: 400,
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
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave38-prompt-latest-turn-guidance-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave38-prompt-latest-turn-guidance.sqlite");
  const sessionId = "sess_wave38_prompt_latest_turn_guidance";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "README.md"),
    "Wave 38 prompt latest turn guidance benchmark.\n",
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
      "sessions build failed for wave38 prompt latest turn guidance gate.",
      sessionsBuild.stderr,
    );
  }

  const controlPlaneBuild = runWorkspaceBuild("@hotflow/control-plane", env);
  if (controlPlaneBuild.status !== 0) {
    fail(
      "control-plane build failed for wave38 prompt latest turn guidance gate.",
      controlPlaneBuild.stderr,
    );
  }

  const cliBuild = runWorkspaceBuild("@hotflow/cli", env);
  if (cliBuild.status !== 0) {
    fail("cli build failed for wave38 prompt latest turn guidance gate.", cliBuild.stderr);
  }

  try {
    seedPromptLatestTurnGuidanceSession(sessionDbPath, sessionId);

    const explainRun = runHotflowCliCommand(
      ["control", "prompt-explain", sessionId, "--turn", "turn_prompt_latest_turn_guidance_gate"],
      env,
    );
    const statusRun = runHotflowCliCommand(["status", sessionId], env);

    const failures = [
      ...verifyRun(explainRun, [
        "Control action: prompt-explain",
        "Latest turn guidance: prior turn turn_previous blocked (approval required)",
      ]),
      ...verifyRun(statusRun, [
        "Step recovery:",
        "Latest turn guidance: prior turn turn_previous blocked (approval required)",
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
      join(resultsDir, "wave38-prompt-latest-turn-guidance-gate-latest.json"),
      JSON.stringify(
        {
          gate: "wave38-prompt-latest-turn-guidance",
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
      fail("wave38 prompt latest turn guidance gate failed.", failures.join("\n"));
    }
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }

  process.stdout.write("wave38 prompt latest turn guidance gate passed.\n");
}

await runGate();
