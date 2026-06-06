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
    fail(`${target} build failed for wave79 static guidance operator surface gate.`, result.stderr);
  }
}

function summarizePromptSection(section) {
  const metadataKeys = section.metadata === undefined ? undefined : Object.keys(section.metadata);
  return {
    id: section.id,
    cacheBucket: section.cacheBucket,
    ...(section.owner === undefined ? {} : { owner: section.owner }),
    ...(section.priority === undefined ? {} : { priority: section.priority }),
    ...(metadataKeys === undefined || metadataKeys.length === 0 ? {} : { metadataKeys }),
    ...(section.metadata === undefined ? {} : { metadataPreview: section.metadata }),
  };
}

function seedSession(sessionDbPath, sessionId, staticSections) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const turnId = "turn_wave79_static_guidance_operator_surface";
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
        items: [{ id: "todo_wave79", content: "static guidance operator surface", status: "todo" }],
      },
      createdAtMs: 100,
    });

    store.appendStepJournal(sessionId, {
      turnId,
      stepIndex: 0,
      eventType: "step.context_built",
      payload: {
        staticSections,
        staticSectionIds: staticSections.map((section) => section.id),
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
  const { resultsDir, repoRoot } = getBenchmarksPaths();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave79-static-guidance-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave79-static-guidance-operator.sqlite");
  const sessionId = "sess_wave79_static_guidance_operator_surface";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "README.md"),
    "Wave 79 static guidance operator surface.\n",
    "utf8",
  );

  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
  };

  buildWorkspace("@hotflow/sessions", env);
  buildWorkspace("@hotflow/runtime-bootstrap", env);
  buildWorkspace("@hotflow/control-plane", env);
  buildWorkspace("@hotflow/cli", env);

  try {
    const { createDefaultRuntimePromptSections } = await import(
      "../../apps/runtime-bootstrap/dist/index.js"
    );
    const runtimeSections = createDefaultRuntimePromptSections({
      defaultProvider: "scripted",
      defaultModel: "hotflow-phase1",
      outputStyle: "normal",
      permissionMode: "ask",
      responseLanguage: "follow-user",
      workspaceRoot,
    });
    const staticSections = runtimeSections.map(summarizePromptSection);

    seedSession(sessionDbPath, sessionId, staticSections);

    const promptExplainRun = runHotflowCliCommand(
      [
        "control",
        "prompt-explain",
        sessionId,
        "--turn",
        "turn_wave79_static_guidance_operator_surface",
      ],
      env,
    );
    const statusRun = runHotflowCliCommand(["status", sessionId], env);

    const failures = [
      ...verifyRun(promptExplainRun, [
        "Control action: prompt-explain",
        "Prompt focus: user input",
        "Static guidance: default output style guidance, default permission mode guidance, default response language guidance",
        "Effective guidance: output-style=normal permission-mode=ask response-language=follow-user",
        "Effective guidance sources: output-style=runtime-default permission-mode=runtime-default response-language=runtime-default",
        "Change since previous prompt build: this is the first prompt build in the turn.",
      ]),
      ...verifyRun(statusRun, [
        "Latest prompt step: 0",
        "Prompt focus: user input",
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
      join(resultsDir, "wave79-static-guidance-operator-surface-gate.json"),
      JSON.stringify(
        {
          gate: "wave79-static-guidance-operator-surface-gate",
          workspaceRoot,
          repoRoot,
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
      fail("wave79 static guidance operator surface gate failed.", failures.join("\n"));
    }
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }

  process.stdout.write("wave79 static guidance operator surface gate passed.\n");
}

await runGate();
