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
      `${target} build failed for wave74 effective guidance source control surface gate.`,
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

function readControlClosureSummary(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const journalEntries = store.journal.list(sessionId);
    const auditEvents = store.listAuditEvents(sessionId);
    const session = store.getSession(sessionId);
    const metadata = readObjectRecord(session?.metadata);

    return {
      outputStyleEvent: journalEntries.find((entry) => entry.eventType === "control.output_style"),
      permissionModeEvent: journalEntries.find(
        (entry) => entry.eventType === "control.permission_mode",
      ),
      responseLanguageEvent: journalEntries.find(
        (entry) => entry.eventType === "control.response_language",
      ),
      controlActionCount: auditEvents.filter((entry) => entry.event.kind === "control.action")
        .length,
      preferences: readObjectRecord(metadata?.preferences),
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
  const workspaceRoot = mkdtempSync(
    join(tmpdir(), "hotflow-wave74-effective-guidance-source-control-"),
  );
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(
    dataDir,
    "sessions",
    "wave74-effective-guidance-source-control.sqlite",
  );
  const sessionId = "sess_wave74_effective_guidance_source_control_surface";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "README.md"),
    "Wave 74 effective guidance source control surface.\n",
    "utf8",
  );

  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
    HOTFLOW_RESPONSE_LANGUAGE: "zh-CN",
  };

  buildWorkspace("@hotflow/sessions", env);
  buildWorkspace("@hotflow/control-plane", env);
  buildWorkspace("@hotflow/cli", env);

  try {
    seedSession(sessionDbPath, sessionId);

    const outputStyleRun = runHotflowCliCommand(
      ["control", "output-style", sessionId, "concise"],
      env,
    );
    const permissionsRun = runHotflowCliCommand(["control", "permissions", sessionId, "deny"], env);
    const languageRun = runHotflowCliCommand(["control", "language", sessionId, "en"], env);

    const failures = [
      ...verifyRun(outputStyleRun, [
        "Control action: output-style",
        "Output style: concise",
        "Effective guidance: output-style=concise permission-mode=ask response-language=zh-CN",
        "Effective guidance sources: output-style=session-override permission-mode=runtime-default response-language=runtime-default",
        "Session guidance: output-style=concise",
      ]),
      ...verifyRun(permissionsRun, [
        "Control action: permissions",
        "Permission mode: deny",
        "Effective guidance: output-style=concise permission-mode=deny response-language=zh-CN",
        "Effective guidance sources: output-style=session-override permission-mode=session-override response-language=runtime-default",
        "Session guidance: output-style=concise permission-mode=deny",
      ]),
      ...verifyRun(languageRun, [
        "Control action: language",
        "Response language: en",
        "Effective guidance: output-style=concise permission-mode=deny response-language=en",
        "Effective guidance sources: output-style=session-override permission-mode=session-override response-language=session-override",
        "Session guidance: output-style=concise permission-mode=deny response-language=en",
      ]),
    ];

    const summary = readControlClosureSummary(sessionDbPath, sessionId);
    if (!summary.outputStyleEvent) {
      failures.push("Expected journal event control.output_style to be written.");
    }
    if (!summary.permissionModeEvent) {
      failures.push("Expected journal event control.permission_mode to be written.");
    }
    if (!summary.responseLanguageEvent) {
      failures.push("Expected journal event control.response_language to be written.");
    }
    if (summary.controlActionCount < 3) {
      failures.push("Expected at least 3 successful control.action audit events.");
    }
    if (
      summary.preferences?.outputStyle !== "concise" ||
      summary.preferences?.permissionMode !== "deny" ||
      summary.preferences?.responseLanguage !== "en"
    ) {
      failures.push("Expected session metadata preferences to persist concise/deny/en guidance.");
    }

    if (failures.length > 0) {
      fail("wave74 effective guidance source control surface gate failed.", failures.join("\n"));
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave74-effective-guidance-source-control-surface-gate.json"),
      JSON.stringify(
        {
          gate: "wave74-effective-guidance-source-control-surface-gate",
          sessionId,
          summary,
          outputStyleStdout: outputStyleRun.stdout,
          permissionsStdout: permissionsRun.stdout,
          languageStdout: languageRun.stdout,
        },
        null,
        2,
      ),
      "utf8",
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }

  process.stdout.write("wave74 effective guidance source control surface gate passed.\n");
}

await runGate();
