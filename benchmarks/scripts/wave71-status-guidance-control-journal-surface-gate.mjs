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
      `${target} build failed for wave71 status guidance control journal surface gate.`,
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
          responseLanguage: "follow-user",
        },
      },
    });
  } finally {
    store.close();
  }
}

function readGateSummary(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const journalEntries = store.journal.list(sessionId);
    const auditEvents = store.listAuditEvents(sessionId);
    const statusCompletedEvents = auditEvents.filter(
      (entry) => entry.event.kind === "cli.status.completed",
    );

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
      statusCompletedPayloads: statusCompletedEvents.map((entry) => entry.event.payload),
    };
  } finally {
    store.close();
  }
}

function formatJournalNeedle(entry) {
  return `Latest guidance control journal: seq ${entry.seq} at ${new Date(entry.createdAtMs).toISOString()}`;
}

function verifyRun(run, expectedNeedles, unexpectedNeedles = []) {
  const failures = [];
  if (run.status !== 0) {
    failures.push(`Expected CLI exit status 0 but received ${run.status}.`);
  }
  for (const needle of expectedNeedles) {
    if (!run.stdout.includes(needle)) {
      failures.push(`Expected CLI stdout to include: ${needle}`);
    }
  }
  for (const needle of unexpectedNeedles) {
    if (run.stdout.includes(needle)) {
      failures.push(`Expected CLI stdout to omit: ${needle}`);
    }
  }
  return failures;
}

async function runGate() {
  const { resultsDir } = getBenchmarksPaths();
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave71-status-guidance-journal-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave71-status-guidance-control-journal.sqlite");
  const sessionId = "sess_wave71_status_guidance_control_journal";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "README.md"),
    "Wave 71 status guidance control journal surface.\n",
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

    const statusBeforeRun = runHotflowCliCommand(["status", sessionId], env);
    const outputStyleRun = runHotflowCliCommand(
      ["control", "output-style", sessionId, "concise"],
      env,
    );
    const statusAfterOutputStyleRun = runHotflowCliCommand(["status", sessionId], env);
    const permissionsRun = runHotflowCliCommand(["control", "permissions", sessionId, "deny"], env);
    const statusAfterPermissionsRun = runHotflowCliCommand(["status", sessionId], env);
    const languageRun = runHotflowCliCommand(["control", "language", sessionId, "zh-CN"], env);
    const statusAfterLanguageRun = runHotflowCliCommand(["status", sessionId], env);

    const summary = readGateSummary(sessionDbPath, sessionId);
    const failures = [
      ...verifyRun(
        statusBeforeRun,
        [
          "Effective guidance: output-style=normal permission-mode=ask response-language=follow-user",
          "Latest turn: (none)",
        ],
        ["Latest guidance control journal:"],
      ),
      ...verifyRun(outputStyleRun, [
        "Control action: output-style",
        "Output style: concise",
        "Effective guidance: output-style=concise permission-mode=ask response-language=follow-user",
      ]),
      ...verifyRun(statusAfterOutputStyleRun, [
        "Latest guidance control: output-style=concise",
        "Latest guidance control detail: normal -> concise",
      ]),
      ...verifyRun(permissionsRun, [
        "Control action: permissions",
        "Permission mode: deny",
        "Effective guidance: output-style=concise permission-mode=deny response-language=follow-user",
      ]),
      ...verifyRun(statusAfterPermissionsRun, [
        "Latest guidance control: permission-mode=deny",
        "Latest guidance control detail: ask -> deny",
      ]),
      ...verifyRun(languageRun, [
        "Control action: language",
        "Response language: zh-CN",
        "Effective guidance: output-style=concise permission-mode=deny response-language=zh-CN",
      ]),
      ...verifyRun(statusAfterLanguageRun, [
        "Latest guidance control: response-language=zh-CN",
        "Latest guidance control detail: follow-user -> zh-CN",
      ]),
    ];

    if (!summary.outputStyleEvent) {
      failures.push("Expected journal event control.output_style to be written.");
    }
    if (!summary.permissionModeEvent) {
      failures.push("Expected journal event control.permission_mode to be written.");
    }
    if (!summary.responseLanguageEvent) {
      failures.push("Expected journal event control.response_language to be written.");
    }

    if (summary.outputStyleEvent) {
      failures.push(
        ...verifyRun(statusAfterOutputStyleRun, [formatJournalNeedle(summary.outputStyleEvent)]),
      );
    }
    if (summary.permissionModeEvent) {
      failures.push(
        ...verifyRun(statusAfterPermissionsRun, [formatJournalNeedle(summary.permissionModeEvent)]),
      );
    }
    if (summary.responseLanguageEvent) {
      failures.push(
        ...verifyRun(statusAfterLanguageRun, [formatJournalNeedle(summary.responseLanguageEvent)]),
      );
    }

    if (
      summary.outputStyleEvent &&
      summary.permissionModeEvent &&
      summary.permissionModeEvent.seq <= summary.outputStyleEvent.seq
    ) {
      failures.push("Expected permission-mode journal seq to advance after output-style.");
    }
    if (
      summary.permissionModeEvent &&
      summary.responseLanguageEvent &&
      summary.responseLanguageEvent.seq <= summary.permissionModeEvent.seq
    ) {
      failures.push("Expected response-language journal seq to advance after permission-mode.");
    }
    if (
      summary.outputStyleEvent &&
      summary.permissionModeEvent &&
      summary.permissionModeEvent.createdAtMs < summary.outputStyleEvent.createdAtMs
    ) {
      failures.push("Expected permission-mode occurredAtMs to be monotonic.");
    }
    if (
      summary.permissionModeEvent &&
      summary.responseLanguageEvent &&
      summary.responseLanguageEvent.createdAtMs < summary.permissionModeEvent.createdAtMs
    ) {
      failures.push("Expected response-language occurredAtMs to be monotonic.");
    }
    if (summary.controlActionCount < 7) {
      failures.push("Expected at least 7 successful control.action audit events.");
    }
    if (summary.statusCompletedPayloads.length < 4) {
      failures.push("Expected at least 4 cli.status.completed audit events.");
    }

    const lastStatusPayload = readObjectRecord(summary.statusCompletedPayloads.at(-1));
    const latestGuidanceControl = readObjectRecord(lastStatusPayload?.latestGuidanceControl);
    if (
      latestGuidanceControl?.action !== "response-language" ||
      latestGuidanceControl?.value !== "zh-CN" ||
      latestGuidanceControl?.previousValue !== "follow-user" ||
      latestGuidanceControl?.journalSeq !== summary.responseLanguageEvent?.seq ||
      latestGuidanceControl?.occurredAtMs !== summary.responseLanguageEvent?.createdAtMs
    ) {
      failures.push(
        "Expected cli.status.completed audit payload to include the latest response-language guidance journal provenance.",
      );
    }

    if (failures.length > 0) {
      fail("wave71 status guidance control journal surface gate failed.", failures.join("\n"));
    }

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "wave71-status-guidance-control-journal-surface-gate.json"),
      JSON.stringify(
        {
          gate: "wave71-status-guidance-control-journal-surface-gate",
          sessionId,
          summary,
          runs: {
            statusBefore: statusBeforeRun,
            outputStyle: outputStyleRun,
            statusAfterOutputStyle: statusAfterOutputStyleRun,
            permissions: permissionsRun,
            statusAfterPermissions: statusAfterPermissionsRun,
            language: languageRun,
            statusAfterLanguage: statusAfterLanguageRun,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    process.stdout.write("wave71 status guidance control journal surface gate passed.\n");
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

await runGate();
