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
      `${target} build failed for wave72 session guidance named dynamic sections gate.`,
      result.stderr,
    );
  }
}

function seedSession(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const turnId = "turn_wave72_named_sections";
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
        items: [{ id: "todo_wave72", content: "named section alignment", status: "todo" }],
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
            id: "session.response-language",
            cacheBucket: "dynamic",
            owner: "runtime",
            metadataKeys: ["responseLanguage"],
            metadataPreview: {
              responseLanguage: "zh-CN",
            },
          },
        ],
        dynamicSectionIds: ["user-input", "session.output-style", "session.response-language"],
        omittedSections: [],
        omittedSectionIds: [],
        usedTokens: 500,
        remainingTokens: 1500,
        runtimeDegradations: [],
      },
      createdAtMs: 120,
    });

    store.appendStepJournal(sessionId, {
      turnId,
      stepIndex: 1,
      eventType: "step.context_built",
      payload: {
        staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
        staticSectionIds: ["system.identity"],
        dynamicSections: [
          { id: "tool-results", cacheBucket: "dynamic", owner: "turn", priority: 80 },
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
          {
            id: "session.response-language",
            cacheBucket: "dynamic",
            owner: "runtime",
            metadataKeys: ["responseLanguage"],
            metadataPreview: {
              responseLanguage: "zh-CN",
            },
          },
          {
            id: "runtime.tool-status",
            cacheBucket: "dynamic",
            owner: "runtime",
            metadataKeys: ["impactedTools", "status"],
            metadataPreview: {
              impactedTools: 2,
              status: "degraded",
            },
          },
        ],
        dynamicSectionIds: [
          "tool-results",
          "session.output-style",
          "session.permission-mode",
          "session.response-language",
          "runtime.tool-status",
        ],
        omittedSections: [],
        omittedSectionIds: [],
        usedTokens: 650,
        remainingTokens: 1350,
        runtimeDegradations: [],
      },
      createdAtMs: 180,
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
      promptInspectActions: countAction("prompt-inspect"),
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
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave72-named-session-guidance-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave72-session-guidance-named-sections.sqlite");
  const sessionId = "sess_wave72_named_session_guidance";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "README.md"),
    "Wave 72 session guidance named dynamic sections.\n",
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
    seedSession(sessionDbPath, sessionId);

    const { DEFAULT_RUNTIME_PROMPT_SECTION_CONTRIBUTORS } = await import(
      "../../packages/context/dist/index.js"
    );
    const contributorIds = DEFAULT_RUNTIME_PROMPT_SECTION_CONTRIBUTORS.map(
      (contributor) => contributor.id,
    );
    const expectedContributorIds = [
      "runtime.turn-resume",
      "runtime.degradations",
      "session.output-style",
      "session.permission-mode",
      "session.response-language",
      "session.latest-turn",
      "runtime.tool-status",
    ];

    const promptInspectRun = runHotflowCliCommand(
      [
        "control",
        "prompt-inspect",
        sessionId,
        "--turn",
        "turn_wave72_named_sections",
        "--step",
        "1",
      ],
      env,
    );
    const promptExplainRun = runHotflowCliCommand(
      ["control", "prompt-explain", sessionId, "--turn", "turn_wave72_named_sections"],
      env,
    );
    const statusRun = runHotflowCliCommand(["status", sessionId], env);

    const failures = [];

    if (JSON.stringify(contributorIds) !== JSON.stringify(expectedContributorIds)) {
      failures.push(
        `Expected runtime prompt contributor ids ${JSON.stringify(expectedContributorIds)} but received ${JSON.stringify(contributorIds)}.`,
      );
    }

    failures.push(
      ...verifyRun(promptInspectRun, [
        "session.output-style cache=dynamic owner=runtime metadata=outputStyle=concise",
        "session.permission-mode cache=dynamic owner=runtime metadata=permissionMode=deny",
        "session.response-language cache=dynamic owner=runtime metadata=responseLanguage=zh-CN",
      ]),
    );
    failures.push(
      ...verifyRun(promptExplainRun, [
        "Prompt focus: tool results, output style guidance, permission mode guidance, response language guidance, tool runtime guidance",
        "Prompt omissions: (none)",
        "Effective guidance: output-style=concise permission-mode=deny response-language=zh-CN",
        "Session guidance: output-style=concise permission-mode=deny response-language=zh-CN",
        "Added dynamic sections: tool results, permission mode guidance, tool runtime guidance",
        "Removed dynamic sections: user input",
      ]),
    );
    failures.push(
      ...verifyRun(statusRun, [
        "Effective guidance: output-style=concise permission-mode=deny response-language=zh-CN",
        "Prompt focus: tool results, output style guidance, permission mode guidance, response language guidance, tool runtime guidance",
        "Prompt guidance: output-style=concise permission-mode=deny response-language=zh-CN",
        "Prompt changes: +tool results +permission mode guidance +tool runtime guidance -user input",
      ]),
    );

    const auditSummary = readAuditSummary(sessionDbPath, sessionId);
    if (auditSummary.promptInspectActions < 1) {
      failures.push("Expected at least 1 successful prompt-inspect control.action audit event.");
    }
    if (auditSummary.promptExplainActions < 1) {
      failures.push("Expected at least 1 successful prompt-explain control.action audit event.");
    }
    if (auditSummary.statusActions < 1) {
      failures.push("Expected at least 1 successful status control.action audit event.");
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave72-session-guidance-named-dynamic-sections-gate.json"),
      JSON.stringify(
        {
          gate: "wave72-session-guidance-named-dynamic-sections-gate",
          workspaceRoot,
          repoRoot,
          contributorIds,
          runs: {
            promptInspect: promptInspectRun,
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
      fail("wave72 session guidance named dynamic sections gate failed.", failures.join("\n"));
    }

    process.stdout.write("wave72 session guidance named dynamic sections gate passed.\n");
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

await runGate();
