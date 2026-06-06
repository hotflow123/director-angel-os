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
      `${target} build failed for wave77 prompt-inspect runtime-default guidance source metadata gate.`,
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
    const turnId = "turn_wave77_prompt_inspect_runtime_default";
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
        usedTokens: 320,
        remainingTokens: 1680,
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
  const workspaceRoot = mkdtempSync(
    join(tmpdir(), "hotflow-wave77-prompt-inspect-runtime-default-"),
  );
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave77-prompt-inspect-runtime-default.sqlite");
  const sessionId = "sess_wave77_prompt_inspect_runtime_default";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "README.md"),
    "Wave 77 prompt-inspect runtime-default guidance source metadata.\n",
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
        "turn_wave77_prompt_inspect_runtime_default",
        "--step",
        "0",
      ],
      env,
    );

    const failures = [];
    const runtimeSection = runtimeSections.find((section) => section.id === "system.runtime");
    if (runtimeSection?.metadata !== undefined) {
      failures.push("Expected system.runtime metadata to be omitted after runtime shell dedup.");
    }
    if (runtimeSection?.content.includes("- Permission mode: ask")) {
      failures.push("Expected system.runtime to stop duplicating permission mode guidance.");
    }
    if (runtimeSection?.content.includes("- Response language: follow-user")) {
      failures.push("Expected system.runtime to stop duplicating response language guidance.");
    }
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
    const outputStyleSection = runtimeSections.find(
      (section) => section.id === "system.output-style",
    );
    if (outputStyleSection?.metadata?.source !== "runtime-default") {
      failures.push("Expected system.output-style metadata.source=runtime-default.");
    }
    if (outputStyleSection?.metadata?.outputStyle !== "normal") {
      failures.push("Expected system.output-style metadata to preserve outputStyle=normal.");
    }

    failures.push(
      ...verifyRun(promptInspectRun, [
        "Control action: prompt-inspect",
        "Effective guidance: output-style=normal permission-mode=ask response-language=follow-user",
        "Effective guidance sources: output-style=runtime-default permission-mode=runtime-default response-language=runtime-default",
        "system.runtime cache=static owner=runtime priority=980",
        "system.permission-mode cache=static owner=runtime priority=975 metadata=permissionMode=ask,source=runtime-default",
        "system.response-language cache=static owner=runtime priority=974 metadata=responseLanguage=follow-user,source=runtime-default",
        "system.output-style cache=static owner=runtime priority=970 metadata=outputStyle=normal,source=runtime-default",
      ]),
    );
    if (
      promptInspectRun.stdout.includes(
        "system.runtime cache=static owner=runtime priority=980 metadata=",
      )
    ) {
      failures.push("Expected prompt-inspect runtime shell line to omit guidance metadata.");
    }

    const auditSummary = readAuditSummary(sessionDbPath, sessionId);
    if (auditSummary.promptInspectActions < 1) {
      failures.push("Expected at least 1 successful prompt-inspect control.action audit event.");
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave77-prompt-inspect-runtime-default-guidance-source-metadata-gate.json"),
      JSON.stringify(
        {
          gate: "wave77-prompt-inspect-runtime-default-guidance-source-metadata-gate",
          workspaceRoot,
          repoRoot,
          promptInspectRun,
          runtimeSections,
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
        "wave77 prompt-inspect runtime-default guidance source metadata gate failed.",
        failures.join("\n"),
      );
    }

    process.stdout.write(
      "wave77 prompt-inspect runtime-default guidance source metadata gate passed.\n",
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

await runGate();
