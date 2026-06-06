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
      `${target} build failed for wave78 runtime-default guidance named static sections gate.`,
      result.stderr,
    );
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
    const turnId = "turn_wave78_runtime_default_named_static_sections";
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
        usedTokens: 360,
        remainingTokens: 1640,
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
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave78-runtime-default-static-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave78-runtime-default-static.sqlite");
  const sessionId = "sess_wave78_runtime_default_named_static_sections";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "README.md"),
    "Wave 78 runtime-default guidance named static sections.\n",
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

    const promptInspectRun = runHotflowCliCommand(
      [
        "control",
        "prompt-inspect",
        sessionId,
        "--turn",
        "turn_wave78_runtime_default_named_static_sections",
        "--step",
        "0",
      ],
      env,
    );

    const failures = [];
    const permissionModeSection = runtimeSections.find(
      (section) => section.id === "system.permission-mode",
    );
    if (permissionModeSection?.metadata?.source !== "runtime-default") {
      failures.push("Expected system.permission-mode metadata.source=runtime-default.");
    }
    if (permissionModeSection?.metadata?.permissionMode !== "ask") {
      failures.push("Expected system.permission-mode metadata to preserve permissionMode=ask.");
    }

    const responseLanguageSection = runtimeSections.find(
      (section) => section.id === "system.response-language",
    );
    if (responseLanguageSection?.metadata?.source !== "runtime-default") {
      failures.push("Expected system.response-language metadata.source=runtime-default.");
    }
    if (responseLanguageSection?.metadata?.responseLanguage !== "follow-user") {
      failures.push(
        "Expected system.response-language metadata to preserve responseLanguage=follow-user.",
      );
    }

    failures.push(
      ...verifyRun(promptInspectRun, [
        "Control action: prompt-inspect",
        "Effective guidance: output-style=normal permission-mode=ask response-language=follow-user",
        "Effective guidance sources: output-style=runtime-default permission-mode=runtime-default response-language=runtime-default",
        "system.permission-mode cache=static owner=runtime priority=975 metadata=permissionMode=ask,source=runtime-default",
        "system.response-language cache=static owner=runtime priority=974 metadata=responseLanguage=follow-user,source=runtime-default",
        "system.output-style cache=static owner=runtime priority=970 metadata=outputStyle=normal,source=runtime-default",
      ]),
    );

    const auditSummary = readAuditSummary(sessionDbPath, sessionId);
    if (auditSummary.promptInspectActions < 1) {
      failures.push("Expected at least 1 successful prompt-inspect control.action audit event.");
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave78-runtime-default-guidance-named-static-sections-gate.json"),
      JSON.stringify(
        {
          gate: "wave78-runtime-default-guidance-named-static-sections-gate",
          workspaceRoot,
          promptInspectStdout: promptInspectRun.stdout,
          auditSummary,
          staticSectionIds: staticSections.map((section) => section.id),
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
        "wave78 runtime-default guidance named static sections gate failed.",
        failures.join("\n"),
      );
    }
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }

  process.stdout.write("wave78 runtime-default guidance named static sections gate passed.\n");
}

await runGate();
