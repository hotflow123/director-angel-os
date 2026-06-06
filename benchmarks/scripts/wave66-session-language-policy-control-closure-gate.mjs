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

function buildWorkspace(target, env) {
  const result = runWorkspaceBuild(target, env);
  if (result.status !== 0) {
    fail(
      `${target} build failed for wave66 session language policy control closure gate.`,
      result.stderr,
    );
  }
}

function seedSession(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    store.createSession({
      sessionId,
      metadata: {
        preferences: {
          outputStyle: "normal",
          permissionMode: "ask",
          responseLanguage: "en",
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

    const responseLanguageEvent = journalEntries.find(
      (entry) => entry.eventType === "control.response_language",
    );
    const controlActionCount = auditEvents.filter(
      (entry) => entry.event.kind === "control.action",
    ).length;

    return {
      responseLanguageEvent,
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
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave66-session-language-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave66-session-language-policy-control.sqlite");
  const sessionId = "sess_wave66_session_language_policy_control_closure";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "README.md"),
    "Wave 66 session language policy control closure.\n",
  );

  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
  };

  buildWorkspace("@hotflow/sessions", env);
  buildWorkspace("@hotflow/context", env);
  buildWorkspace("@hotflow/control-plane", env);
  buildWorkspace("@hotflow/cli", env);

  seedSession(sessionDbPath, sessionId);

  const languageRun = runHotflowCliCommand(["control", "language", sessionId, "zh-CN"], env);
  const statusRun = runHotflowCliCommand(["status", sessionId], env);

  const failures = [
    ...verifyRun(languageRun, [
      "Control action: language",
      "Previous response language: en",
      "Response language: zh-CN",
      "Session guidance: output-style=normal permission-mode=ask response-language=zh-CN",
    ]),
    ...verifyRun(statusRun, [
      "Session guidance: output-style=normal permission-mode=ask response-language=zh-CN",
      "Latest turn: (none)",
    ]),
  ];

  const summary = readSessionClosureSummary(sessionDbPath, sessionId);
  if (!summary.responseLanguageEvent) {
    failures.push("Expected journal event control.response_language to be written.");
  }
  if (
    summary.responseLanguageEvent?.payload?.previousLanguage !== "en" ||
    summary.responseLanguageEvent?.payload?.language !== "zh-CN"
  ) {
    failures.push(
      "Expected control.response_language payload to include previousLanguage=en and language=zh-CN.",
    );
  }
  if (
    summary.responseLanguageEvent?.payload?.sessionGuidance?.outputStyle !== "normal" ||
    summary.responseLanguageEvent?.payload?.sessionGuidance?.permissionMode !== "ask" ||
    summary.responseLanguageEvent?.payload?.sessionGuidance?.responseLanguage !== "zh-CN"
  ) {
    failures.push(
      "Expected control.response_language payload to preserve outputStyle/permissionMode and persist responseLanguage=zh-CN.",
    );
  }
  if (summary.controlActionCount < 2) {
    failures.push("Expected at least 2 successful control.action audit events.");
  }
  if (
    summary.preferences?.outputStyle !== "normal" ||
    summary.preferences?.permissionMode !== "ask" ||
    summary.preferences?.responseLanguage !== "zh-CN"
  ) {
    failures.push(
      "Expected session metadata preferences to persist normal/ask/zh-CN session guidance.",
    );
  }

  if (failures.length > 0) {
    fail("wave66 session language policy control closure gate failed.", failures.join("\n"));
  }

  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    join(resultsDir, "wave66-session-language-policy-control-closure-gate.json"),
    JSON.stringify(
      {
        gate: "wave66-session-language-policy-control-closure-gate",
        sessionId,
        summary,
        languageStdout: languageRun.stdout,
        statusStdout: statusRun.stdout,
      },
      null,
      2,
    ),
    "utf8",
  );

  process.stdout.write("wave66 session language policy control closure gate passed.\n");
}

await runGate();
