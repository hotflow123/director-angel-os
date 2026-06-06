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
      `${target} build failed for wave83 prompt-inspect static runtime summary surface gate.`,
      result.stderr,
    );
  }
}

function seedSession(sessionDbPath, sessionId, workspaceRoot) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const turnId = "turn_wave83_prompt_inspect_static_runtime_summary";
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

    store.appendJournal(sessionId, {
      eventType: "tasks.todo_write",
      payload: {
        items: [
          { id: "todo_wave83", content: "prompt inspect static runtime summary", status: "todo" },
        ],
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
              outputStyle: "verbose",
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
              permissionMode: "allow",
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
              responseLanguage: "fr",
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
          {
            id: "session.output-style",
            cacheBucket: "dynamic",
            owner: "runtime",
            priority: 95,
            metadataKeys: ["outputStyle", "source"],
            metadataPreview: {
              outputStyle: "concise",
              source: "session-override",
            },
          },
        ],
        dynamicSectionIds: ["user-input", "session.output-style"],
        omittedSections: [],
        omittedSectionIds: [],
        usedTokens: 540,
        remainingTokens: 1460,
        runtimeDegradations: [],
      },
      createdAtMs: 120,
    });

    writeFileSync(
      join(workspaceRoot, "README.md"),
      "Wave 83 prompt-inspect static runtime summary surface.\n",
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
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave83-prompt-inspect-static-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(
    dataDir,
    "sessions",
    "wave83-prompt-inspect-static-runtime-summary.sqlite",
  );
  const sessionId = "sess_wave83_prompt_inspect_static_runtime_summary";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });

  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
    HOTFLOW_OUTPUT_STYLE: "normal",
    HOTFLOW_PERMISSION_MODE: "ask",
    HOTFLOW_RESPONSE_LANGUAGE: "zh-CN",
  };

  buildWorkspace("@hotflow/sessions", env);
  buildWorkspace("@hotflow/control-plane", env);
  buildWorkspace("@hotflow/cli", env);

  try {
    seedSession(sessionDbPath, sessionId, workspaceRoot);

    const promptInspectRun = runHotflowCliCommand(
      [
        "control",
        "prompt-inspect",
        sessionId,
        "--turn",
        "turn_wave83_prompt_inspect_static_runtime_summary",
        "--step",
        "0",
      ],
      env,
    );

    const failures = verifyRun(promptInspectRun, [
      "Control action: prompt-inspect",
      "Effective guidance: output-style=concise permission-mode=allow response-language=fr",
      "Effective guidance sources: output-style=session-override permission-mode=runtime-default response-language=runtime-default",
      "Session guidance: output-style=concise",
      "Runtime shell: runtime shell",
      "Static guidance: default output style guidance, default permission mode guidance, default response language guidance",
      "system.runtime cache=static owner=runtime priority=980",
      "system.output-style cache=static owner=runtime priority=970 metadata=outputStyle=verbose,source=runtime-default",
      "system.permission-mode cache=static owner=runtime priority=975 metadata=permissionMode=allow,source=runtime-default",
      "system.response-language cache=static owner=runtime priority=974 metadata=responseLanguage=fr,source=runtime-default",
    ]);

    const auditSummary = readAuditSummary(sessionDbPath, sessionId);
    if (auditSummary.promptInspectActions < 1) {
      failures.push("Expected at least 1 successful prompt-inspect control.action audit event.");
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave83-prompt-inspect-static-runtime-summary-surface-gate.json"),
      JSON.stringify(
        {
          gate: "wave83-prompt-inspect-static-runtime-summary-surface-gate",
          workspaceRoot,
          repoRoot,
          promptInspectRun,
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
        "wave83 prompt-inspect static runtime summary surface gate failed.",
        failures.join("\n"),
      );
    }

    process.stdout.write("wave83 prompt-inspect static runtime summary surface gate passed.\n");
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

await runGate();
