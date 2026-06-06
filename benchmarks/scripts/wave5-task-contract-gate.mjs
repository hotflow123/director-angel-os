import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { getBenchmarksPaths, runCliCommand } from "./cli-command.mjs";

function fail(message, details) {
  if (details) {
    process.stderr.write(`${message}\n${details}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function extractSessionId(output) {
  const match = /^Session:\s*(.+)$/mu.exec(output);
  return match?.[1]?.trim() ?? null;
}

function applyTokens(value, context) {
  if (typeof value !== "string") {
    return value;
  }
  if (context.sessionId) {
    return value.replaceAll("{{sessionId}}", context.sessionId);
  }
  return value;
}

function ensureSessionRow(db, sessionId, createdAtMs) {
  const row = db.prepare("SELECT session_id FROM sessions WHERE session_id = ?").get(sessionId);
  if (row) {
    return;
  }
  db.prepare(
    `INSERT INTO sessions
       (session_id, metadata_json, status, schema_version, created_at_ms, updated_at_ms, archived_at_ms, archive_reason)
       VALUES (?, ?, 'active', 'sessions/v1', ?, ?, NULL, NULL)`,
  ).run(sessionId, "{}", createdAtMs, createdAtMs);
}

function appendLegacyWrappedTodoEvent(input) {
  const db = new DatabaseSync(input.sessionDbPath);
  try {
    ensureSessionRow(db, input.sessionId, input.createdAtMs);
    const latestSeqRow = db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM journal_entries WHERE session_id = ?")
      .get(input.sessionId);
    const nextSeq = Number(latestSeqRow?.max_seq ?? 0) + 1;
    const payload = {
      todos: {
        items: [
          {
            id: input.todoId,
            content: input.todoContent,
            status: "todo",
          },
        ],
        updatedAtMs: input.createdAtMs,
      },
      updatedAtMs: input.createdAtMs,
    };

    db.prepare(
      `INSERT INTO journal_entries
         (session_id, seq, event_type, turn_id, payload_json, schema_version, created_at_ms)
         VALUES (?, ?, 'tasks.todo_write', NULL, ?, 'sessions/v1', ?)`,
    ).run(input.sessionId, nextSeq, JSON.stringify(payload), input.createdAtMs);

    db.prepare(
      `UPDATE sessions
         SET updated_at_ms = CASE
           WHEN updated_at_ms < ? THEN ?
           ELSE updated_at_ms
         END
         WHERE session_id = ?`,
    ).run(input.createdAtMs, input.createdAtMs, input.sessionId);

    return {
      ok: true,
      seq: nextSeq,
      payload,
    };
  } finally {
    db.close();
  }
}

function assertLatestTodoPayloadFlat(input) {
  const db = new DatabaseSync(input.sessionDbPath, { readOnly: true });
  try {
    const row = db
      .prepare(
        `SELECT payload_json, seq, row_id
           FROM journal_entries
          WHERE session_id = ? AND event_type = 'tasks.todo_write'
          ORDER BY seq DESC, row_id DESC
          LIMIT 1`,
      )
      .get(input.sessionId);

    if (!row || typeof row.payload_json !== "string") {
      return {
        ok: false,
        reason: "No tasks.todo_write event found for session.",
      };
    }

    let payload;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      return {
        ok: false,
        reason: "Latest tasks.todo_write payload is not valid JSON.",
      };
    }

    const hasFlatItems =
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      Array.isArray(payload.items);
    const hasWrappedTodos =
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      payload.todos &&
      typeof payload.todos === "object";
    const isFlat = hasFlatItems && !hasWrappedTodos;

    return {
      ok: Boolean(isFlat),
      reason: isFlat
        ? ""
        : "Latest tasks.todo_write payload is not flat TaskState (expected root.items and no root.todos).",
      hasFlatItems: Boolean(hasFlatItems),
      hasWrappedTodos: Boolean(hasWrappedTodos),
      seq: row.seq,
      rowId: row.row_id,
    };
  } finally {
    db.close();
  }
}

function runStep(step, context, sessionDbPath) {
  const stepType = typeof step.type === "string" ? step.type : "cli";

  if (stepType === "cli") {
    const command = Array.isArray(step.command)
      ? step.command.map((token) => applyTokens(token, context))
      : [];
    if (command.length === 0) {
      return {
        ok: false,
        status: null,
        durationMs: 0,
        command,
        reason: `Step ${step.id} has no command tokens.`,
        stderr: "",
        stdoutPreview: "",
      };
    }

    const result = runCliCommand(command, { sessionDbPath });
    const expectedStdoutIncludes = Array.isArray(step.expectStdoutIncludes)
      ? step.expectStdoutIncludes.map((needle) => applyTokens(needle, context))
      : [];
    const missingStdoutIncludes = expectedStdoutIncludes.filter(
      (needle) => typeof needle === "string" && !result.stdout.includes(needle),
    );
    if (step.captureSessionId === true || !context.sessionId) {
      const maybeSessionId = extractSessionId(result.stdout);
      if (maybeSessionId) {
        context.sessionId = maybeSessionId;
      }
    }

    return {
      ok: result.status === 0 && missingStdoutIncludes.length === 0,
      status: result.status,
      durationMs: Number(result.durationMs.toFixed(2)),
      command,
      expectedStdoutIncludes,
      missingStdoutIncludes,
      stderr: result.stderr.trim(),
      stdoutPreview: result.stdout.split("\n").slice(0, 20).join("\n"),
      reason:
        result.status !== 0
          ? `Step ${step.id} failed with status ${result.status}.`
          : missingStdoutIncludes.length > 0
            ? `Step ${step.id} missing expected stdout fragments: ${missingStdoutIncludes.join(", ")}`
            : "",
    };
  }

  if (stepType === "append-legacy-wrapped-todo") {
    if (!context.sessionId) {
      return {
        ok: false,
        status: null,
        durationMs: 0,
        command: [],
        stderr: "",
        stdoutPreview: "",
        reason: `Step ${step.id} requires sessionId in context.`,
      };
    }
    const createdAtMs = Date.now();
    const writeResult = appendLegacyWrappedTodoEvent({
      sessionDbPath,
      sessionId: context.sessionId,
      createdAtMs,
      todoId: `legacy_todo_${createdAtMs}`,
      todoContent:
        typeof step.todoContent === "string" && step.todoContent.length > 0
          ? step.todoContent
          : "legacy wrapped todo payload",
    });

    return {
      ok: writeResult.ok,
      status: 0,
      durationMs: 0,
      command: [],
      stderr: "",
      stdoutPreview: JSON.stringify({
        type: stepType,
        seq: writeResult.seq,
      }),
      reason: writeResult.ok ? "" : "Failed to append legacy wrapped tasks.todo_write event.",
    };
  }

  if (stepType === "assert-flat-todo-payload") {
    if (!context.sessionId) {
      return {
        ok: false,
        status: null,
        durationMs: 0,
        command: [],
        stderr: "",
        stdoutPreview: "",
        reason: `Step ${step.id} requires sessionId in context.`,
      };
    }
    const assertion = assertLatestTodoPayloadFlat({
      sessionDbPath,
      sessionId: context.sessionId,
    });
    return {
      ok: assertion.ok,
      status: assertion.ok ? 0 : 1,
      durationMs: 0,
      command: [],
      stderr: "",
      stdoutPreview: JSON.stringify(assertion),
      reason: assertion.ok ? "" : assertion.reason,
    };
  }

  return {
    ok: false,
    status: null,
    durationMs: 0,
    command: [],
    stderr: "",
    stdoutPreview: "",
    reason: `Unknown step type: ${stepType}`,
  };
}

function runCaseIteration(benchmarkCase, iteration, tempDir) {
  const runStartedAt = new Date().toISOString();
  const sessionDbPath = resolve(
    tempDir,
    `wave5-taskcontract-${benchmarkCase.id}-${iteration}-${Date.now()}.sqlite`,
  );
  const caseContext = benchmarkCase?.context;
  const context = {
    sessionId:
      caseContext && typeof caseContext.sessionId === "string" ? caseContext.sessionId : null,
  };

  const stepReports = [];
  let totalDurationMs = 0;
  let passed = true;
  let failureReason = "";

  for (const step of benchmarkCase.steps) {
    const stepResult = runStep(step, context, sessionDbPath);
    totalDurationMs += stepResult.durationMs;
    stepReports.push({
      id: step.id,
      type: typeof step.type === "string" ? step.type : "cli",
      ok: stepResult.ok,
      status: stepResult.status,
      durationMs: Number(stepResult.durationMs.toFixed(2)),
      command: stepResult.command,
      expectedStdoutIncludes: stepResult.expectedStdoutIncludes ?? [],
      missingStdoutIncludes: stepResult.missingStdoutIncludes ?? [],
      stderr: stepResult.stderr,
      stdoutPreview: stepResult.stdoutPreview,
      reason: stepResult.reason,
    });

    if (!stepResult.ok) {
      passed = false;
      failureReason = stepResult.reason || `Step ${step.id} failed.`;
      break;
    }
  }

  return {
    caseId: benchmarkCase.id,
    iteration,
    ok: passed,
    startedAt: runStartedAt,
    finishedAt: new Date().toISOString(),
    sessionId: context.sessionId,
    durationMs: Number(totalDurationMs.toFixed(2)),
    failureReason,
    steps: stepReports,
  };
}

const { benchmarksDir, resultsDir, tempDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave5-task-contract-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

if (!Array.isArray(fixture.cases) || fixture.cases.length === 0) {
  fail("No Wave 5 task contract cases found in fixture.");
}

const selectedCases = fixture.cases.filter(
  (benchmarkCase) =>
    benchmarkCase &&
    typeof benchmarkCase.id === "string" &&
    Array.isArray(benchmarkCase.steps) &&
    benchmarkCase.steps.length > 0,
);
if (selectedCases.length === 0) {
  fail("No valid Wave 5 task contract cases selected from fixture.");
}

const iterations = toPositiveInteger(
  process.env.HF_WAVE5_TASKCONTRACT_ITERATIONS,
  toPositiveInteger(fixture.iterations, 1),
);

const runs = [];
for (const benchmarkCase of selectedCases) {
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    runs.push(runCaseIteration(benchmarkCase, iteration, tempDir));
  }
}

const failedRuns = runs.filter((run) => !run.ok);
const durations = runs.map((run) => run.durationMs);
const summary = {
  suiteId: typeof fixture.suiteId === "string" ? fixture.suiteId : "wave5-task-contract-gate",
  timestamp: new Date().toISOString(),
  iterations,
  totalRuns: runs.length,
  failedRuns: failedRuns.length,
  durationMs: {
    min: durations.length > 0 ? Math.min(...durations) : 0,
    max: durations.length > 0 ? Math.max(...durations) : 0,
    avg:
      durations.length > 0
        ? Number((durations.reduce((acc, value) => acc + value, 0) / durations.length).toFixed(2))
        : 0,
  },
};

mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave5-task-contract-gate-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary,
      runs,
    },
    null,
    2,
  ),
);

process.stdout.write(
  `Wave 5 task contract gate completed: ${summary.totalRuns} runs, failed ${summary.failedRuns}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (summary.failedRuns > 0) {
  process.exitCode = 1;
}
