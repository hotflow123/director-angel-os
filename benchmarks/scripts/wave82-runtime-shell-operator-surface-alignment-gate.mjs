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
      `${target} build failed for wave82 runtime shell operator surface alignment gate.`,
      result.stderr,
    );
  }
}

function seedSession(sessionDbPath, sessionId, workspaceRoot) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const turnId = "turn_wave82_runtime_shell_operator_surface";
    store.createSession({
      sessionId,
      metadata: {
        runtime: {
          latestTurn: {
            turnId,
            providerId: "scripted",
            model: "hotflow-phase1",
          },
        },
      },
    });

    store.appendJournal(sessionId, {
      eventType: "tasks.todo_write",
      payload: {
        items: [{ id: "todo_wave82", content: "runtime shell operator surface", status: "todo" }],
      },
      createdAtMs: 100,
    });

    store.appendStepJournal(sessionId, {
      turnId,
      stepIndex: 0,
      eventType: "step.context_built",
      payload: {
        staticSections: [
          { id: "system.identity", cacheBucket: "static", owner: "runtime", priority: 1000 },
          { id: "system.runtime", cacheBucket: "static", owner: "runtime", priority: 980 },
          {
            id: "system.output-style",
            cacheBucket: "static",
            owner: "runtime",
            priority: 970,
            metadataKeys: ["outputStyle", "source"],
            metadataPreview: {
              outputStyle: "normal",
              source: "runtime-default",
            },
          },
          {
            id: "system.permission-mode",
            cacheBucket: "static",
            owner: "runtime",
            priority: 975,
            metadataKeys: ["permissionMode", "source"],
            metadataPreview: {
              permissionMode: "ask",
              source: "runtime-default",
            },
          },
          {
            id: "system.response-language",
            cacheBucket: "static",
            owner: "runtime",
            priority: 974,
            metadataKeys: ["responseLanguage", "source"],
            metadataPreview: {
              responseLanguage: "follow-user",
              source: "runtime-default",
            },
          },
        ],
        staticSectionIds: [
          "system.identity",
          "system.runtime",
          "system.output-style",
          "system.permission-mode",
          "system.response-language",
        ],
        dynamicSections: [
          { id: "user-input", cacheBucket: "dynamic", owner: "turn", priority: 100 },
        ],
        dynamicSectionIds: ["user-input"],
        omittedSections: [],
        omittedSectionIds: [],
        usedTokens: 340,
        remainingTokens: 1660,
        runtimeDegradations: [],
      },
      createdAtMs: 120,
    });

    writeFileSync(
      join(workspaceRoot, "README.md"),
      "Wave 82 runtime shell operator surface alignment.\n",
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
    const countAction = (action) =>
      auditEvents.filter((entry) => {
        if (entry.event.kind !== "control.action") {
          return false;
        }

        const payload = entry.event.payload;
        return (
          payload &&
          typeof payload === "object" &&
          !Array.isArray(payload) &&
          payload.action === action &&
          payload.ok === true
        );
      }).length;

    return {
      totalAuditEvents: auditEvents.length,
      promptExplainActions: countAction("prompt-explain"),
      statusActions: countAction("status"),
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
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave82-runtime-shell-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave82-runtime-shell-operator-surface.sqlite");
  const sessionId = "sess_wave82_runtime_shell_operator_surface";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });

  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
    HOTFLOW_OUTPUT_STYLE: "normal",
    HOTFLOW_PERMISSION_MODE: "ask",
    HOTFLOW_RESPONSE_LANGUAGE: "follow-user",
  };

  buildWorkspace("@hotflow/sessions", env);
  buildWorkspace("@hotflow/control-plane", env);
  buildWorkspace("@hotflow/cli", env);

  try {
    seedSession(sessionDbPath, sessionId, workspaceRoot);

    const promptExplainRun = runHotflowCliCommand(
      [
        "control",
        "prompt-explain",
        sessionId,
        "--turn",
        "turn_wave82_runtime_shell_operator_surface",
      ],
      env,
    );
    const statusRun = runHotflowCliCommand(["status", sessionId], env);

    const failures = [
      ...verifyRun(promptExplainRun, [
        "Control action: prompt-explain",
        "Prompt focus: user input",
        "Runtime shell: runtime shell",
        "Static guidance: default output style guidance, default permission mode guidance, default response language guidance",
        "Effective guidance: output-style=normal permission-mode=ask response-language=follow-user",
        "Effective guidance sources: output-style=runtime-default permission-mode=runtime-default response-language=runtime-default",
      ]),
      ...verifyRun(statusRun, [
        "Latest prompt step: 0",
        "Prompt focus: user input",
        "Prompt runtime shell: runtime shell",
        "Prompt static guidance: default output style guidance, default permission mode guidance, default response language guidance",
        "Prompt guidance: output-style=normal permission-mode=ask response-language=follow-user",
        "Prompt guidance sources: output-style=runtime-default permission-mode=runtime-default response-language=runtime-default",
      ]),
    ];

    const auditSummary = readAuditSummary(sessionDbPath, sessionId);
    if (auditSummary.promptExplainActions < 1) {
      failures.push("Expected at least 1 successful prompt-explain control.action audit event.");
    }
    if (auditSummary.statusActions < 1) {
      failures.push("Expected at least 1 successful status control.action audit event.");
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave82-runtime-shell-operator-surface-alignment-gate.json"),
      JSON.stringify(
        {
          gate: "wave82-runtime-shell-operator-surface-alignment-gate",
          workspaceRoot,
          runs: {
            promptExplain: promptExplainRun,
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
      fail("wave82 runtime shell operator surface alignment gate failed.", failures.join("\n"));
    }
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }

  process.stdout.write("wave82 runtime shell operator surface alignment gate passed.\n");
}

await runGate();
