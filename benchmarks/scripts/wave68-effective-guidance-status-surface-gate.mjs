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

function readObjectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function seedEffectiveGuidanceSession(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    store.createSession({ sessionId });
  } finally {
    store.close();
  }
}

function attachPromptGuidanceTurn(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const session = store.getSession(sessionId);
    const metadata = readObjectRecord(session?.metadata) ?? {};
    const runtime = readObjectRecord(metadata.runtime) ?? {};

    store.updateMetadata(sessionId, {
      ...metadata,
      runtime: {
        ...runtime,
        latestTurn: {
          turnId: "turn_wave68_effective_guidance",
          providerId: "openai-live",
          model: "gpt-5-mini",
        },
      },
    });

    store.appendJournal(sessionId, {
      eventType: "tasks.todo_write",
      payload: {
        items: [
          { id: "todo_wave68", content: "effective guidance status surface", status: "todo" },
        ],
      },
      createdAtMs: 100,
    });

    store.appendStepJournal(sessionId, {
      turnId: "turn_wave68_effective_guidance",
      stepIndex: 0,
      eventType: "step.context_built",
      payload: {
        staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
        staticSectionIds: ["system.identity"],
        dynamicSections: [
          { id: "user-input", cacheBucket: "dynamic", owner: "turn" },
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
        dynamicSectionIds: ["user-input", "session.guidance"],
        omittedSections: [],
        omittedSectionIds: [],
        usedTokens: 420,
        remainingTokens: 1580,
        runtimeDegradations: [],
      },
      createdAtMs: 200,
    });
  } finally {
    store.close();
  }
}

function readAuditSummary(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const auditEvents = store.listAuditEvents(sessionId);
    const countAction = (action) =>
      auditEvents.filter((entry) => {
        if (entry.event.kind !== "control.action") {
          return false;
        }

        const payload = readObjectRecord(entry.event.payload);
        return payload?.action === action && payload.ok === true;
      }).length;

    const session = store.getSession(sessionId);
    const metadata = readObjectRecord(session?.metadata);
    const preferences = readObjectRecord(metadata?.preferences);

    return {
      totalAuditEvents: auditEvents.length,
      statusActions: countAction("status"),
      outputStyleActions: countAction("output-style"),
      promptExplainActions: countAction("prompt-explain"),
      cliStatusCompleted: auditEvents.filter((entry) => entry.event.kind === "cli.status.completed")
        .length,
      preferences,
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
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave68-effective-guidance-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave68-effective-guidance.sqlite");
  const sessionId = "sess_wave68_effective_guidance";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "README.md"),
    "Wave 68 effective guidance status surface benchmark.\n",
    "utf8",
  );

  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
    HOTFLOW_RESPONSE_LANGUAGE: "zh-CN",
  };

  const sessionsBuild = runWorkspaceBuild("@hotflow/sessions", env);
  if (sessionsBuild.status !== 0) {
    fail("sessions build failed for wave68 effective guidance gate.", sessionsBuild.stderr);
  }

  const controlPlaneBuild = runWorkspaceBuild("@hotflow/control-plane", env);
  if (controlPlaneBuild.status !== 0) {
    fail(
      "control-plane build failed for wave68 effective guidance gate.",
      controlPlaneBuild.stderr,
    );
  }

  const cliBuild = runWorkspaceBuild("@hotflow/cli", env);
  if (cliBuild.status !== 0) {
    fail("cli build failed for wave68 effective guidance gate.", cliBuild.stderr);
  }

  try {
    seedEffectiveGuidanceSession(sessionDbPath, sessionId);

    const baselineStatusRun = runHotflowCliCommand(["status", sessionId], env);
    const outputStyleRun = runHotflowCliCommand(
      ["control", "output-style", sessionId, "concise"],
      env,
    );

    attachPromptGuidanceTurn(sessionDbPath, sessionId);

    const statusRun = runHotflowCliCommand(["status", sessionId], env);
    const promptExplainRun = runHotflowCliCommand(
      ["control", "prompt-explain", sessionId, "--turn", "turn_wave68_effective_guidance"],
      env,
    );

    const failures = [
      ...verifyRun(baselineStatusRun, [
        "Latest turn: (none)",
        "Effective guidance: output-style=normal permission-mode=ask response-language=zh-CN",
      ]),
      ...verifyRun(outputStyleRun, [
        "Control action: output-style",
        "Output style: concise",
        "Session guidance: output-style=concise",
      ]),
      ...verifyRun(statusRun, [
        "Latest turn: turn_wave68_effective_guidance",
        "Effective guidance: output-style=concise permission-mode=ask response-language=zh-CN",
        "Prompt guidance: output-style=concise permission-mode=ask response-language=zh-CN",
      ]),
      ...verifyRun(promptExplainRun, [
        "Control action: prompt-explain",
        "Turn: turn_wave68_effective_guidance",
        "Effective guidance: output-style=concise permission-mode=ask response-language=zh-CN",
        "Session guidance: output-style=concise",
      ]),
    ];

    const auditSummary = readAuditSummary(sessionDbPath, sessionId);
    if (auditSummary.outputStyleActions < 1) {
      failures.push("Expected at least 1 successful output-style control.action audit event.");
    }
    if (auditSummary.statusActions < 2) {
      failures.push("Expected at least 2 successful status control.action audit events.");
    }
    if (auditSummary.promptExplainActions < 1) {
      failures.push("Expected at least 1 successful prompt-explain control.action audit event.");
    }
    if (auditSummary.cliStatusCompleted < 2) {
      failures.push("Expected at least 2 cli.status.completed audit events.");
    }
    if (auditSummary.preferences?.outputStyle !== "concise") {
      failures.push("Expected session metadata preferences.outputStyle=concise to persist.");
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave68-effective-guidance-status-surface-gate.json"),
      JSON.stringify(
        {
          gate: "wave68-effective-guidance-status-surface-gate",
          workspaceRoot,
          repoRoot,
          runs: {
            baselineStatus: baselineStatusRun,
            outputStyle: outputStyleRun,
            status: statusRun,
            promptExplain: promptExplainRun,
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
      fail("wave68 effective guidance status surface gate failed.", failures.join("\n"));
    }
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }

  process.stdout.write("wave68 effective guidance status surface gate passed.\n");
}

await runGate();
