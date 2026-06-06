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

function buildWorkspace(target, env) {
  const result = runWorkspaceBuild(target, env);
  if (result.status !== 0) {
    fail(
      `${target} build failed for wave73 effective guidance source surface gate.`,
      result.stderr,
    );
  }
}

function seedSession(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    store.createSession({ sessionId });
  } finally {
    store.close();
  }
}

function attachPromptTurn(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const session = store.getSession(sessionId);
    const metadata = readObjectRecord(session?.metadata) ?? {};
    const runtime = readObjectRecord(metadata.runtime) ?? {};
    const turnId = "turn_wave73_effective_guidance_source";

    store.updateMetadata(sessionId, {
      ...metadata,
      runtime: {
        ...runtime,
        latestTurn: {
          turnId,
          providerId: "openai-live",
          model: "gpt-5-mini",
        },
      },
    });

    store.appendJournal(sessionId, {
      eventType: "tasks.todo_write",
      payload: {
        items: [
          { id: "todo_wave73", content: "effective guidance source surface", status: "todo" },
        ],
      },
      createdAtMs: 100,
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
          {
            id: "session.output-style",
            cacheBucket: "dynamic",
            owner: "runtime",
            metadataKeys: ["outputStyle"],
            metadataPreview: {
              outputStyle: "concise",
            },
          },
          {
            id: "session.permission-mode",
            cacheBucket: "dynamic",
            owner: "runtime",
            metadataKeys: ["permissionMode"],
            metadataPreview: {
              permissionMode: "deny",
            },
          },
        ],
        dynamicSectionIds: ["user-input", "session.output-style", "session.permission-mode"],
        omittedSections: [],
        omittedSectionIds: [],
        usedTokens: 520,
        remainingTokens: 1480,
        runtimeDegradations: [],
      },
      createdAtMs: 180,
    });
  } finally {
    store.close();
  }
}

function readGateSummary(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const auditEvents = store.listAuditEvents(sessionId);
    const statusCompletedPayloads = auditEvents
      .filter((entry) => entry.event.kind === "cli.status.completed")
      .map((entry) => entry.event.payload);

    return {
      controlActionCount: auditEvents.filter((entry) => entry.event.kind === "control.action")
        .length,
      statusCompletedPayloads,
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

function expectGuidanceSources(payload, expectedSources, failures, label) {
  const sourceRecord = readObjectRecord(payload?.effectiveGuidanceSources);
  for (const [key, value] of Object.entries(expectedSources)) {
    if (sourceRecord?.[key] !== value) {
      failures.push(
        `${label} expected effectiveGuidanceSources.${key}=${value} but received ${String(sourceRecord?.[key])}.`,
      );
    }
  }
}

async function runGate() {
  const { resultsDir } = getBenchmarksPaths();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave73-guidance-source-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave73-effective-guidance-source.sqlite");
  const sessionId = "sess_wave73_effective_guidance_source";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "README.md"),
    "Wave 73 effective guidance source surface benchmark.\n",
    "utf8",
  );

  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
    HOTFLOW_RESPONSE_LANGUAGE: "follow-user",
  };

  buildWorkspace("@hotflow/sessions", env);
  buildWorkspace("@hotflow/control-plane", env);
  buildWorkspace("@hotflow/cli", env);

  try {
    seedSession(sessionDbPath, sessionId);

    const baselineStatusRun = runHotflowCliCommand(["status", sessionId], env);
    const outputStyleRun = runHotflowCliCommand(
      ["control", "output-style", sessionId, "concise"],
      env,
    );
    const singleOverrideStatusRun = runHotflowCliCommand(["status", sessionId], env);
    const permissionsRun = runHotflowCliCommand(["control", "permissions", sessionId, "deny"], env);

    attachPromptTurn(sessionDbPath, sessionId);

    const mixedOverrideStatusRun = runHotflowCliCommand(["status", sessionId], env);
    const promptExplainRun = runHotflowCliCommand(
      ["control", "prompt-explain", sessionId, "--turn", "turn_wave73_effective_guidance_source"],
      env,
    );

    const failures = [
      ...verifyRun(baselineStatusRun, [
        "Effective guidance: output-style=normal permission-mode=ask response-language=follow-user",
        "Effective guidance sources: output-style=runtime-default permission-mode=runtime-default response-language=runtime-default",
      ]),
      ...verifyRun(outputStyleRun, [
        "Control action: output-style",
        "Output style: concise",
        "Effective guidance: output-style=concise permission-mode=ask response-language=follow-user",
      ]),
      ...verifyRun(singleOverrideStatusRun, [
        "Effective guidance: output-style=concise permission-mode=ask response-language=follow-user",
        "Effective guidance sources: output-style=session-override permission-mode=runtime-default response-language=runtime-default",
      ]),
      ...verifyRun(permissionsRun, [
        "Control action: permissions",
        "Permission mode: deny",
        "Effective guidance: output-style=concise permission-mode=deny response-language=follow-user",
      ]),
      ...verifyRun(mixedOverrideStatusRun, [
        "Effective guidance: output-style=concise permission-mode=deny response-language=follow-user",
        "Effective guidance sources: output-style=session-override permission-mode=session-override response-language=runtime-default",
        "Prompt guidance: output-style=concise permission-mode=deny response-language=follow-user",
        "Prompt guidance sources: output-style=session-override permission-mode=session-override response-language=runtime-default",
      ]),
      ...verifyRun(promptExplainRun, [
        "Control action: prompt-explain",
        "Turn: turn_wave73_effective_guidance_source",
        "Effective guidance: output-style=concise permission-mode=deny response-language=follow-user",
        "Effective guidance sources: output-style=session-override permission-mode=session-override response-language=runtime-default",
      ]),
    ];

    const summary = readGateSummary(sessionDbPath, sessionId);
    if (summary.controlActionCount < 5) {
      failures.push("Expected at least 5 successful control.action audit events.");
    }
    if (summary.statusCompletedPayloads.length < 3) {
      failures.push("Expected at least 3 cli.status.completed audit events.");
    }

    const [baselinePayload, singleOverridePayload, mixedOverridePayload] =
      summary.statusCompletedPayloads.slice(-3).map((payload) => readObjectRecord(payload));

    expectGuidanceSources(
      baselinePayload,
      {
        outputStyle: "runtime-default",
        permissionMode: "runtime-default",
        responseLanguage: "runtime-default",
      },
      failures,
      "baseline status payload",
    );
    expectGuidanceSources(
      singleOverridePayload,
      {
        outputStyle: "session-override",
        permissionMode: "runtime-default",
        responseLanguage: "runtime-default",
      },
      failures,
      "single override status payload",
    );
    expectGuidanceSources(
      mixedOverridePayload,
      {
        outputStyle: "session-override",
        permissionMode: "session-override",
        responseLanguage: "runtime-default",
      },
      failures,
      "mixed override status payload",
    );

    if (failures.length > 0) {
      fail("Wave 73 effective guidance source surface gate failed.", failures.join("\n"));
    }

    writeFileSync(
      join(resultsDir, "wave73-effective-guidance-source-surface-gate.json"),
      JSON.stringify(
        {
          ok: true,
          sessionId,
          workspaceRoot,
          controlActionCount: summary.controlActionCount,
          statusCompletedPayloads: summary.statusCompletedPayloads.length,
        },
        null,
        2,
      ),
      "utf8",
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

await runGate();
