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
      `${target} build failed for wave75 prompt-inspect guidance source metadata gate.`,
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

function seedSession(sessionDbPath, sessionId, dynamicSections) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const turnId = "turn_wave75_prompt_inspect_source";
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
          { id: "user-input", cacheBucket: "dynamic", owner: "turn", priority: 100 },
          ...dynamicSections,
        ],
        dynamicSectionIds: ["user-input", ...dynamicSections.map((section) => section.id)],
        omittedSections: [],
        omittedSectionIds: [],
        usedTokens: 500,
        remainingTokens: 1500,
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
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave75-prompt-inspect-source-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave75-prompt-inspect-source.sqlite");
  const sessionId = "sess_wave75_prompt_inspect_source";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "README.md"),
    "Wave 75 prompt-inspect guidance source metadata.\n",
    "utf8",
  );

  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
    HOTFLOW_RESPONSE_LANGUAGE: "follow-user",
  };

  buildWorkspace("@hotflow/context", env);
  buildWorkspace("@hotflow/sessions", env);
  buildWorkspace("@hotflow/control-plane", env);
  buildWorkspace("@hotflow/cli", env);

  try {
    const { createSessionGuidanceSections } = await import("../../packages/context/dist/index.js");
    const guidanceSections = createSessionGuidanceSections({
      preferences: {
        outputStyle: "concise",
        permissionMode: "deny",
        responseLanguage: "zh-CN",
      },
    });
    const sectionSummaries = guidanceSections.map(summarizePromptSection);

    seedSession(sessionDbPath, sessionId, sectionSummaries);

    const promptInspectRun = runHotflowCliCommand(
      [
        "control",
        "prompt-inspect",
        sessionId,
        "--turn",
        "turn_wave75_prompt_inspect_source",
        "--step",
        "0",
      ],
      env,
    );

    const failures = [];
    for (const [sectionId, field] of [
      ["session.output-style", "outputStyle"],
      ["session.permission-mode", "permissionMode"],
      ["session.response-language", "responseLanguage"],
    ]) {
      const section = guidanceSections.find((entry) => entry.id === sectionId);
      if (!section) {
        failures.push(`Expected ${sectionId} to be generated by createSessionGuidanceSections().`);
        continue;
      }
      if (section.metadata?.source !== "session-override") {
        failures.push(
          `Expected ${sectionId} metadata.source to equal session-override but received ${String(section.metadata?.source)}.`,
        );
      }
      const metadataKeys = section.metadata === undefined ? [] : Object.keys(section.metadata);
      if (JSON.stringify(metadataKeys) !== JSON.stringify([field, "source"])) {
        failures.push(
          `Expected ${sectionId} metadata keys ${JSON.stringify([field, "source"])} but received ${JSON.stringify(metadataKeys)}.`,
        );
      }
    }

    failures.push(
      ...verifyRun(promptInspectRun, [
        "Control action: prompt-inspect",
        "session.output-style cache=dynamic owner=runtime priority=95 metadata=outputStyle=concise,source=session-override",
        "session.permission-mode cache=dynamic owner=runtime priority=94 metadata=permissionMode=deny,source=session-override",
        "session.response-language cache=dynamic owner=runtime priority=93 metadata=responseLanguage=zh-CN,source=session-override",
      ]),
    );

    const auditSummary = readAuditSummary(sessionDbPath, sessionId);
    if (auditSummary.promptInspectActions < 1) {
      failures.push("Expected at least 1 successful prompt-inspect control.action audit event.");
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave75-prompt-inspect-guidance-source-metadata-gate.json"),
      JSON.stringify(
        {
          gate: "wave75-prompt-inspect-guidance-source-metadata-gate",
          workspaceRoot,
          repoRoot,
          promptInspectRun,
          guidanceSections,
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
      fail("wave75 prompt-inspect guidance source metadata gate failed.", failures.join("\n"));
    }

    process.stdout.write("wave75 prompt-inspect guidance source metadata gate passed.\n");
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

await runGate();
