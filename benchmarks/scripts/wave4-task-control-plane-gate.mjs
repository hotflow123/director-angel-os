import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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

function runCaseIteration(benchmarkCase, iteration, tempDir) {
  const runStartedAt = new Date().toISOString();
  const sessionDbPath = resolve(
    tempDir,
    `wave4-taskplane-${benchmarkCase.id}-${iteration}-${Date.now()}.sqlite`,
  );
  const context = {
    sessionId: null,
  };

  const stepReports = [];
  let totalDurationMs = 0;
  let passed = true;
  let failureReason = "";

  for (const step of benchmarkCase.steps) {
    const command = Array.isArray(step.command)
      ? step.command.map((token) => applyTokens(token, context))
      : [];
    if (command.length === 0) {
      passed = false;
      failureReason = `Step ${step.id} has no command tokens.`;
      stepReports.push({
        id: step.id,
        ok: false,
        status: null,
        durationMs: 0,
        command,
        expectedStdoutIncludes: [],
        missingStdoutIncludes: [],
        stderr: "",
        stdoutPreview: "",
        reason: failureReason,
      });
      break;
    }

    const result = runCliCommand(command, { sessionDbPath });
    totalDurationMs += result.durationMs;
    if (!context.sessionId) {
      context.sessionId = extractSessionId(result.stdout);
    }
    const expectedStdoutIncludes = Array.isArray(step.expectStdoutIncludes)
      ? step.expectStdoutIncludes.map((entry) => applyTokens(entry, context))
      : [];
    const missingStdoutIncludes = expectedStdoutIncludes.filter(
      (needle) => typeof needle === "string" && !result.stdout.includes(needle),
    );
    const stepOk = result.status === 0 && missingStdoutIncludes.length === 0;

    stepReports.push({
      id: step.id,
      ok: stepOk,
      status: result.status,
      durationMs: Number(result.durationMs.toFixed(2)),
      command,
      expectedStdoutIncludes,
      missingStdoutIncludes,
      stderr: result.stderr.trim(),
      stdoutPreview: result.stdout.split("\n").slice(0, 20).join("\n"),
    });

    if (!stepOk) {
      passed = false;
      failureReason =
        result.status !== 0
          ? `Step ${step.id} failed with status ${result.status}.`
          : `Step ${step.id} missing expected stdout fragments: ${missingStdoutIncludes.join(", ")}`;
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
const fixturePath = resolve(benchmarksDir, "fixtures", "wave4-task-control-plane-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

if (!Array.isArray(fixture.cases) || fixture.cases.length === 0) {
  fail("No Wave 4 task/control-plane cases found in fixture.");
}

const selectedCases = fixture.cases.filter(
  (benchmarkCase) =>
    benchmarkCase &&
    typeof benchmarkCase.id === "string" &&
    Array.isArray(benchmarkCase.steps) &&
    benchmarkCase.steps.length > 0,
);
if (selectedCases.length === 0) {
  fail("No valid Wave 4 task/control-plane cases selected from fixture.");
}

const iterations = toPositiveInteger(
  process.env.HF_WAVE4_TASKPLANE_ITERATIONS,
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
  suiteId: typeof fixture.suiteId === "string" ? fixture.suiteId : "wave4-task-control-plane-gate",
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
const outputPath = resolve(resultsDir, "wave4-task-control-plane-gate-latest.json");
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
  `Wave 4 task/control-plane gate completed: ${summary.totalRuns} runs, failed ${summary.failedRuns}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (summary.failedRuns > 0) {
  process.exitCode = 1;
}
