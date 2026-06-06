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
      `${target} build failed for wave84 prompt-inspect dynamic runtime summary surface gate.`,
      result.stderr,
    );
  }
}

function seedSession(sessionDbPath, sessionId, workspaceRoot) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const turnId = "turn_wave84_prompt_inspect_dynamic_runtime_summary";
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
          { id: "todo_wave84", content: "prompt inspect dynamic runtime summary", status: "todo" },
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
        ],
        staticSectionIds: ["system.identity", "system.runtime"],
        dynamicSections: [
          { id: "user-input", cacheBucket: "dynamic", owner: "turn", priority: 100 },
          {
            id: "runtime.tool-status",
            cacheBucket: "dynamic",
            owner: "runtime",
            priority: 96,
            metadataKeys: [
              "status",
              "impactedTools",
              "previewedTools",
              "toolPreview",
              "metaImpactedTools",
              "metaPreviewedTools",
              "toolMetaPreview",
            ],
            metadataPreview: {
              status: "degraded",
              impactedTools: 2,
              previewedTools: 2,
              toolPreview: "filesystem.read_text:degraded|tools.exec:missing",
              metaImpactedTools: 1,
              metaPreviewedTools: 1,
              toolMetaPreview: "filesystem.read_text[replay=trimmed]",
            },
          },
          {
            id: "runtime.turn-resume",
            cacheBucket: "dynamic",
            owner: "runtime",
            priority: 95,
            metadataKeys: ["resumeAction", "nextStepIndex", "recoveredToolResults"],
            metadataPreview: {
              resumeAction: "continue-current-step",
              nextStepIndex: 1,
              recoveredToolResults: 1,
            },
          },
          {
            id: "session.latest-turn",
            cacheBucket: "dynamic",
            owner: "runtime",
            priority: 94,
            metadataKeys: ["turnId", "runtimeStatus", "turnBranch"],
            metadataPreview: {
              turnId: "turn_previous",
              runtimeStatus: "blocked",
              turnBranch: "approval-required",
            },
          },
        ],
        dynamicSectionIds: [
          "user-input",
          "runtime.tool-status",
          "runtime.turn-resume",
          "session.latest-turn",
        ],
        omittedSections: [],
        omittedSectionIds: [],
        usedTokens: 520,
        remainingTokens: 1480,
        runtimeDegradations: [
          {
            stage: "context",
            category: "budget",
            severity: "warn",
            reason: "token_budget_low",
            message: "Prompt recall sections were trimmed by budget.",
            metadataPreview: {
              trimmedSections: 1,
            },
          },
        ],
      },
      createdAtMs: 120,
    });

    writeFileSync(
      join(workspaceRoot, "README.md"),
      "Wave 84 prompt-inspect dynamic runtime summary surface.\n",
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
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave84-prompt-inspect-dynamic-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(
    dataDir,
    "sessions",
    "wave84-prompt-inspect-dynamic-runtime-summary.sqlite",
  );
  const sessionId = "sess_wave84_prompt_inspect_dynamic_runtime_summary";

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
        "turn_wave84_prompt_inspect_dynamic_runtime_summary",
        "--step",
        "0",
      ],
      env,
    );

    const failures = verifyRun(promptInspectRun, [
      "Control action: prompt-inspect",
      "Runtime shell: runtime shell",
      "Tool runtime guidance: degraded (2 impacted tools)",
      "Tool runtime details: filesystem.read_text: degraded, tools.exec: missing",
      "Tool runtime metadata: filesystem.read_text [replay=trimmed]",
      "Turn resume guidance: continue current step -> step 1 1 recovered tool result",
      "Latest turn guidance: prior turn turn_previous blocked (approval required)",
      "Prompt degradations: budget trim [warn]",
      "runtime.tool-status cache=dynamic owner=runtime priority=96 metadata=status=degraded,impactedTools=2,previewedTools=2,toolPreview=filesystem.read_text:degraded|tools.exec:missing,metaImpactedTools=1,metaPreviewedTools=1,toolMetaPreview=filesystem.read_text[replay=trimmed]",
      "runtime.turn-resume cache=dynamic owner=runtime priority=95 metadata=resumeAction=continue-current-step,nextStepIndex=1,recoveredToolResults=1",
      "session.latest-turn cache=dynamic owner=runtime priority=94 metadata=turnId=turn_previous,runtimeStatus=blocked,turnBranch=approval-required",
    ]);

    const auditSummary = readAuditSummary(sessionDbPath, sessionId);
    if (auditSummary.promptInspectActions < 1) {
      failures.push("Expected at least 1 successful prompt-inspect control.action audit event.");
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave84-prompt-inspect-dynamic-runtime-summary-surface-gate.json"),
      JSON.stringify(
        {
          gate: "wave84-prompt-inspect-dynamic-runtime-summary-surface-gate",
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
        "wave84 prompt-inspect dynamic runtime summary surface gate failed.",
        failures.join("\n"),
      );
    }

    process.stdout.write("wave84 prompt-inspect dynamic runtime summary surface gate passed.\n");
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

await runGate();
