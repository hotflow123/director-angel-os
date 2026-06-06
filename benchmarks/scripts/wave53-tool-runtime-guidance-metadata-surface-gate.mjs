import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

function createToolRuntimeMetadataPreview() {
  return {
    impactedTools: 4,
    status: "degraded",
    previewedTools: 3,
    previewTruncated: true,
    toolPreview:
      "filesystem.read_text:degraded|tasks.todo_write:approval_required|tools.exec:missing",
    metaImpactedTools: 3,
    metaPreviewedTools: 2,
    metaPreviewTruncated: true,
    toolMetaPreview:
      "filesystem.read_text[availability=missing-env,env=HOTFLOW_TOKEN]|tasks.todo_write[approval=pending]",
  };
}

function seedToolRuntimeGuidanceMetadataSession(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  const toolRuntimeMetadataPreview = createToolRuntimeMetadataPreview();

  try {
    store.createSession({
      sessionId,
      metadata: {
        runtime: {
          latestTurn: {
            turnId: "turn_prompt_tool_runtime_metadata_gate",
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
          {
            id: "todo_tool_runtime_metadata",
            content: "tool runtime metadata todo",
            status: "todo",
          },
        ],
      },
      createdAtMs: 100,
    });

    store.appendStepJournal(sessionId, {
      turnId: "turn_prompt_tool_runtime_metadata_gate",
      stepIndex: 0,
      eventType: "step.context_built",
      payload: {
        staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
        staticSectionIds: ["system.identity"],
        dynamicSections: [{ id: "user-input", cacheBucket: "dynamic", owner: "turn" }],
        dynamicSectionIds: ["user-input"],
        omittedSections: [
          { id: "working-memory.recall-1", cacheBucket: "dynamic", owner: "memory" },
        ],
        omittedSectionIds: ["working-memory.recall-1"],
        usedTokens: 480,
        remainingTokens: 1520,
        runtimeDegradations: [],
      },
      createdAtMs: 200,
    });

    store.appendStepJournal(sessionId, {
      turnId: "turn_prompt_tool_runtime_metadata_gate",
      stepIndex: 1,
      eventType: "step.context_built",
      payload: {
        staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
        staticSectionIds: ["system.identity"],
        dynamicSections: [
          { id: "tool-results", cacheBucket: "dynamic", owner: "turn", priority: 80 },
          {
            id: "session.guidance",
            cacheBucket: "dynamic",
            owner: "runtime",
            metadataKeys: ["outputStyle", "permissionMode"],
            metadataPreview: {
              outputStyle: "concise",
              permissionMode: "ask",
            },
          },
          {
            id: "runtime.tool-status",
            cacheBucket: "dynamic",
            owner: "runtime",
            metadataKeys: [
              "impactedTools",
              "status",
              "previewedTools",
              "previewTruncated",
              "toolPreview",
              "metaImpactedTools",
              "metaPreviewedTools",
              "metaPreviewTruncated",
              "toolMetaPreview",
            ],
            metadataPreview: toolRuntimeMetadataPreview,
          },
        ],
        dynamicSectionIds: ["tool-results", "session.guidance", "runtime.tool-status"],
        omittedSections: [{ id: "runtime.degradations", cacheBucket: "dynamic", owner: "runtime" }],
        omittedSectionIds: ["runtime.degradations"],
        usedTokens: 640,
        remainingTokens: 1360,
        runtimeDegradations: [],
      },
      createdAtMs: 300,
    });

    store.appendStepJournal(sessionId, {
      turnId: "turn_prompt_tool_runtime_metadata_gate",
      stepIndex: 1,
      eventType: "step.tool_result",
      payload: {
        results: [{ toolName: "tasks.todo_write", resolution: "executed", ok: true }],
      },
      createdAtMs: 400,
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
  const { resultsDir } = getBenchmarksPaths();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave53-tool-runtime-metadata-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave53-tool-runtime-guidance-metadata.sqlite");
  const sessionId = "sess_wave53_tool_runtime_guidance_metadata";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "README.md"),
    "Wave 53 tool runtime guidance metadata surface benchmark.\n",
    "utf8",
  );

  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
  };

  const sessionsBuild = runWorkspaceBuild("@hotflow/sessions", env);
  if (sessionsBuild.status !== 0) {
    fail(
      "sessions build failed for wave53 tool runtime guidance metadata surface gate.",
      sessionsBuild.stderr,
    );
  }

  const controlPlaneBuild = runWorkspaceBuild("@hotflow/control-plane", env);
  if (controlPlaneBuild.status !== 0) {
    fail(
      "control-plane build failed for wave53 tool runtime guidance metadata surface gate.",
      controlPlaneBuild.stderr,
    );
  }

  const cliBuild = runWorkspaceBuild("@hotflow/cli", env);
  if (cliBuild.status !== 0) {
    fail(
      "cli build failed for wave53 tool runtime guidance metadata surface gate.",
      cliBuild.stderr,
    );
  }

  seedToolRuntimeGuidanceMetadataSession(sessionDbPath, sessionId);

  const inspectRun = runHotflowCliCommand(
    ["control", "prompt-inspect", sessionId, "--turn", "turn_prompt_tool_runtime_metadata_gate"],
    env,
  );
  const explainRun = runHotflowCliCommand(
    ["control", "prompt-explain", sessionId, "--turn", "turn_prompt_tool_runtime_metadata_gate"],
    env,
  );
  const statusRun = runHotflowCliCommand(["status", sessionId], env);

  const metadataNeedles = [
    "metaImpactedTools=3,metaPreviewedTools=2,metaPreviewTruncated=true",
    "toolMetaPreview=filesystem.read_text[availability=missing-env,env=HOTFLOW_TOKEN]|tasks.todo_write[approval=pending]",
  ];
  const operatorMetadataNeedle =
    "Tool runtime metadata: filesystem.read_text [availability=missing-env,env=HOTFLOW_TOKEN], tasks.todo_write [approval=pending] (+1 more)";

  const failures = [
    ...verifyRun(inspectRun, [
      "Control action: prompt-inspect",
      "Dynamic sections: 3",
      ...metadataNeedles,
    ]),
    ...verifyRun(explainRun, [
      "Control action: prompt-explain",
      "Tool runtime guidance: degraded (4 impacted tools)",
      operatorMetadataNeedle,
    ]),
    ...verifyRun(statusRun, [
      "Step recovery:",
      "Tool runtime guidance: degraded (4 impacted tools)",
      operatorMetadataNeedle,
    ]),
  ];

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

  if (failures.length > 0) {
    fail("wave53 tool runtime guidance metadata surface gate failed.", failures.join("\n"));
  }

  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    join(resultsDir, "wave53-tool-runtime-guidance-metadata-surface-gate.json"),
    JSON.stringify(
      {
        gate: "wave53-tool-runtime-guidance-metadata-surface-gate",
        sessionId,
        auditSummary,
        inspectStdout: inspectRun.stdout,
        explainStdout: explainRun.stdout,
        statusStdout: statusRun.stdout,
      },
      null,
      2,
    ),
    "utf8",
  );

  process.stdout.write("wave53 tool runtime guidance metadata surface gate passed.\n");
}

await runGate();
