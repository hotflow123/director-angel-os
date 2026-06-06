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
      `${target} build failed for wave76 prompt-inspect guidance summary surface gate.`,
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
    const turnId = "turn_wave76_prompt_inspect_summary";
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
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave76-prompt-inspect-summary-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave76-prompt-inspect-summary.sqlite");
  const sessionId = "sess_wave76_prompt_inspect_summary";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "README.md"),
    "Wave 76 prompt-inspect guidance summary surface.\n",
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
        "turn_wave76_prompt_inspect_summary",
        "--step",
        "0",
      ],
      env,
    );

    const failures = verifyRun(promptInspectRun, [
      "Control action: prompt-inspect",
      "Effective guidance: output-style=concise permission-mode=deny response-language=follow-user",
      "Effective guidance sources: output-style=session-override permission-mode=session-override response-language=runtime-default",
      "Session guidance: output-style=concise permission-mode=deny",
      "session.output-style cache=dynamic owner=runtime priority=95 metadata=outputStyle=concise,source=session-override",
      "session.permission-mode cache=dynamic owner=runtime priority=94 metadata=permissionMode=deny,source=session-override",
    ]);

    const auditSummary = readAuditSummary(sessionDbPath, sessionId);
    if (auditSummary.promptInspectActions < 1) {
      failures.push("Expected at least 1 successful prompt-inspect control.action audit event.");
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave76-prompt-inspect-guidance-summary-surface-gate.json"),
      JSON.stringify(
        {
          gate: "wave76-prompt-inspect-guidance-summary-surface-gate",
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
      fail("wave76 prompt-inspect guidance summary surface gate failed.", failures.join("\n"));
    }

    process.stdout.write("wave76 prompt-inspect guidance summary surface gate passed.\n");
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

await runGate();
