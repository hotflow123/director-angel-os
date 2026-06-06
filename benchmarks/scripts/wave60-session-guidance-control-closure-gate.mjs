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

function seedSessionGuidanceControlClosureSession(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    store.createSession({
      sessionId,
      metadata: {
        preferences: {
          outputStyle: "normal",
          permissionMode: "ask",
        },
      },
    });
  } finally {
    store.close();
  }
}

function readSessionClosureSummary(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const journalEntries = store.journal.list(sessionId);
    const auditEvents = store.listAuditEvents(sessionId);
    const session = store.getSession(sessionId);

    const outputStyleEvent = journalEntries.find(
      (entry) => entry.eventType === "control.output_style",
    );
    const permissionModeEvent = journalEntries.find(
      (entry) => entry.eventType === "control.permission_mode",
    );
    const controlActionCount = auditEvents.filter(
      (entry) => entry.event.kind === "control.action",
    ).length;

    return {
      outputStyleEvent,
      permissionModeEvent,
      controlActionCount,
      preferences:
        session?.metadata &&
        typeof session.metadata === "object" &&
        !Array.isArray(session.metadata) &&
        session.metadata.preferences &&
        typeof session.metadata.preferences === "object" &&
        !Array.isArray(session.metadata.preferences)
          ? session.metadata.preferences
          : null,
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
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave60-session-guidance-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave60-session-guidance-control.sqlite");
  const sessionId = "sess_wave60_session_guidance_control_closure";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(join(workspaceRoot, "README.md"), "Wave 60 session guidance control closure.\n");

  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
  };

  const sessionsBuild = runWorkspaceBuild("@hotflow/sessions", env);
  if (sessionsBuild.status !== 0) {
    fail(
      "sessions build failed for wave60 session guidance control closure gate.",
      sessionsBuild.stderr,
    );
  }

  const controlPlaneBuild = runWorkspaceBuild("@hotflow/control-plane", env);
  if (controlPlaneBuild.status !== 0) {
    fail(
      "control-plane build failed for wave60 session guidance control closure gate.",
      controlPlaneBuild.stderr,
    );
  }

  const cliBuild = runWorkspaceBuild("@hotflow/cli", env);
  if (cliBuild.status !== 0) {
    fail("cli build failed for wave60 session guidance control closure gate.", cliBuild.stderr);
  }

  seedSessionGuidanceControlClosureSession(sessionDbPath, sessionId);

  const outputStyleRun = runHotflowCliCommand(
    ["control", "output-style", sessionId, "concise"],
    env,
  );
  const permissionsRun = runHotflowCliCommand(["control", "permissions", sessionId, "deny"], env);
  const statusRun = runHotflowCliCommand(["status", sessionId], env);

  const failures = [
    ...verifyRun(outputStyleRun, [
      "Control action: output-style",
      "Previous output style: normal",
      "Output style: concise",
      "Session guidance: output-style=concise permission-mode=ask",
    ]),
    ...verifyRun(permissionsRun, [
      "Control action: permissions",
      "Previous permission mode: ask",
      "Permission mode: deny",
      "Session guidance: output-style=concise permission-mode=deny",
    ]),
    ...verifyRun(statusRun, [
      "Session guidance: output-style=concise permission-mode=deny",
      "Latest turn: (none)",
    ]),
  ];

  const summary = readSessionClosureSummary(sessionDbPath, sessionId);
  if (!summary.outputStyleEvent) {
    failures.push("Expected journal event control.output_style to be written.");
  }
  if (!summary.permissionModeEvent) {
    failures.push("Expected journal event control.permission_mode to be written.");
  }
  if (summary.controlActionCount < 3) {
    failures.push("Expected at least 3 successful control.action audit events.");
  }
  if (
    summary.preferences?.outputStyle !== "concise" ||
    summary.preferences?.permissionMode !== "deny"
  ) {
    failures.push("Expected session metadata preferences to persist concise/deny guidance.");
  }

  if (failures.length > 0) {
    fail("wave60 session guidance control closure gate failed.", failures.join("\n"));
  }

  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    join(resultsDir, "wave60-session-guidance-control-closure-gate.json"),
    JSON.stringify(
      {
        gate: "wave60-session-guidance-control-closure-gate",
        sessionId,
        summary,
        outputStyleStdout: outputStyleRun.stdout,
        permissionsStdout: permissionsRun.stdout,
        statusStdout: statusRun.stdout,
      },
      null,
      2,
    ),
    "utf8",
  );

  process.stdout.write("wave60 session guidance control closure gate passed.\n");
}

await runGate();
