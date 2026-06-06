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
      `${target} build failed for wave85 prompt-inspect focus/omission summary surface gate.`,
      result.stderr,
    );
  }
}

function seedSession(sessionDbPath, sessionId, workspaceRoot) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const turnId = "turn_wave85_prompt_inspect_focus_omission_summary";
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
          { id: "todo_wave85", content: "prompt inspect focus omission summary", status: "todo" },
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
            id: "session.guidance",
            cacheBucket: "dynamic",
            owner: "runtime",
            priority: 97,
            metadataKeys: ["outputStyle", "permissionMode"],
            metadataPreview: {
              outputStyle: "concise",
              permissionMode: "deny",
            },
          },
          {
            id: "runtime.tool-status",
            cacheBucket: "dynamic",
            owner: "runtime",
            priority: 96,
            metadataKeys: ["status", "impactedTools", "previewedTools", "toolPreview"],
            metadataPreview: {
              status: "degraded",
              impactedTools: 2,
              previewedTools: 2,
              toolPreview: "filesystem.read_text:degraded|tools.exec:missing",
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
          "session.guidance",
          "runtime.tool-status",
          "runtime.turn-resume",
          "session.latest-turn",
        ],
        omittedSections: [
          {
            id: "working-memory.recall-1",
            cacheBucket: "dynamic",
            owner: "memory",
          },
        ],
        omittedSectionIds: ["working-memory.recall-1"],
        usedTokens: 540,
        remainingTokens: 1460,
        runtimeDegradations: [
          {
            stage: "context",
            category: "budget",
            severity: "warn",
            reason: "token_budget_low",
            message: "Prompt recall sections were trimmed by budget.",
          },
        ],
      },
      createdAtMs: 120,
    });

    writeFileSync(
      join(workspaceRoot, "README.md"),
      "Wave 85 prompt-inspect focus and omission summary surface.\n",
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
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave85-prompt-inspect-focus-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(
    dataDir,
    "sessions",
    "wave85-prompt-inspect-focus-omission-summary.sqlite",
  );
  const sessionId = "sess_wave85_prompt_inspect_focus_omission_summary";

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
        "turn_wave85_prompt_inspect_focus_omission_summary",
        "--step",
        "0",
      ],
      env,
    );

    const failures = verifyRun(promptInspectRun, [
      "Control action: prompt-inspect",
      "Prompt focus: user input, session guidance, tool runtime guidance, turn resume guidance, latest turn guidance",
      "Prompt omissions: working memory recall 1",
      "Tool runtime guidance: degraded (2 impacted tools)",
      "Turn resume guidance: continue current step -> step 1 1 recovered tool result",
      "Latest turn guidance: prior turn turn_previous blocked (approval required)",
      "Prompt degradations: budget trim [warn]",
      "session.guidance cache=dynamic owner=runtime priority=97 metadata=outputStyle=concise,permissionMode=deny",
      "working-memory.recall-1 cache=dynamic owner=memory",
    ]);

    const auditSummary = readAuditSummary(sessionDbPath, sessionId);
    if (auditSummary.promptInspectActions < 1) {
      failures.push("Expected at least 1 successful prompt-inspect control.action audit event.");
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave85-prompt-inspect-focus-omission-summary-surface-gate.json"),
      JSON.stringify(
        {
          gate: "wave85-prompt-inspect-focus-omission-summary-surface-gate",
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
        "wave85 prompt-inspect focus/omission summary surface gate failed.",
        failures.join("\n"),
      );
    }

    process.stdout.write("wave85 prompt-inspect focus/omission summary surface gate passed.\n");
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

await runGate();
