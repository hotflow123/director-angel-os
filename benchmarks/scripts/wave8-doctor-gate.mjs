import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function fail(message, details) {
  if (details) {
    process.stderr.write(`${message}\n${details}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

function applyTokens(value, context) {
  if (typeof value !== "string") {
    return value;
  }
  return value
    .replaceAll("{{tempDir}}", context.tempDir)
    .replaceAll("{{sessionDbPath}}", context.sessionDbPath);
}

function runDoctorCli(repoRoot, command, env) {
  const started = process.hrtime.bigint();
  const result = spawnSync(pnpmBin, ["--filter", "@hotflow/cli", "dev", "--", ...command], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs,
  };
}

function coerceReport(output) {
  try {
    return JSON.parse(output);
  } catch {
    const jsonStart = output.indexOf("{");
    const jsonEnd = output.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
      return null;
    }

    try {
      return JSON.parse(output.slice(jsonStart, jsonEnd + 1));
    } catch {
      return null;
    }
  }
}

function getCheck(report, id) {
  if (!report || !Array.isArray(report.checks)) {
    return null;
  }
  return report.checks.find((check) => check && check.id === id) ?? null;
}

function renderCheckForSearch(check) {
  if (!check || typeof check !== "object") {
    return "";
  }
  try {
    return JSON.stringify(check);
  } catch {
    return String(check);
  }
}

function compareExpectedReport(report, expectedReport, context) {
  const failures = [];

  const expectedOverall = expectedReport.overall ?? expectedReport.status;
  if (typeof expectedOverall === "string" && report?.status !== expectedOverall) {
    failures.push(
      `Expected overall/status ${expectedOverall} but received ${report?.status ?? "(missing)"}.`,
    );
  }

  if (expectedReport.effective && typeof expectedReport.effective === "object") {
    const effective = report?.effective ?? {};
    for (const [key, rawValue] of Object.entries(expectedReport.effective)) {
      const expectedValue = applyTokens(rawValue, context);
      const actualValue = effective?.[key];
      if (actualValue !== expectedValue) {
        failures.push(
          `Expected effective.${key}=${JSON.stringify(expectedValue)} but received ${JSON.stringify(actualValue)}.`,
        );
      }
    }
  }

  if (Array.isArray(expectedReport.checks)) {
    for (const expectedCheck of expectedReport.checks) {
      const actualCheck = getCheck(report, expectedCheck.id);
      if (!actualCheck) {
        failures.push(`Missing check ${expectedCheck.id}.`);
        continue;
      }
      if (expectedCheck.status && actualCheck.status !== expectedCheck.status) {
        failures.push(
          `Expected check ${expectedCheck.id} status ${expectedCheck.status} but received ${actualCheck.status}.`,
        );
      }
      if (Array.isArray(expectedCheck.includes)) {
        const haystack = renderCheckForSearch(actualCheck);
        for (const rawNeedle of expectedCheck.includes) {
          const needle = applyTokens(rawNeedle, context);
          if (typeof needle === "string" && !haystack.includes(needle)) {
            failures.push(`Expected check ${expectedCheck.id} to include ${needle}.`);
          }
        }
      }
    }
  }

  return failures;
}

function runCaseIteration(benchmarkCase, iteration, repoRoot, tempDir) {
  const sessionDbPath = resolve(tempDir, `wave8-doctor-${benchmarkCase.id}-${iteration}.sqlite`);
  const context = {
    tempDir,
    sessionDbPath,
  };
  const command = Array.isArray(benchmarkCase.command)
    ? benchmarkCase.command.map((token) => applyTokens(token, context))
    : [];
  const envOverrides = {};
  for (const [key, rawValue] of Object.entries(benchmarkCase.env ?? {})) {
    envOverrides[key] = applyTokens(rawValue, context);
  }

  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: repoRoot,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
    ...envOverrides,
  };

  const result = runDoctorCli(repoRoot, command, env);
  const report = benchmarkCase.expectStructuredReport ? coerceReport(result.stdout) : null;
  const failures = [];

  if (result.status !== benchmarkCase.expectStatus) {
    failures.push(
      `Expected exit status ${benchmarkCase.expectStatus} but received ${result.status}.`,
    );
  }

  if (benchmarkCase.expectStructuredReport && !report) {
    failures.push("Expected JSON doctor report but stdout was not valid JSON.");
  }

  if (report && benchmarkCase.expectReport) {
    failures.push(...compareExpectedReport(report, benchmarkCase.expectReport, context));
  }

  if (benchmarkCase.expectSessionDbPathCreated === true && !existsSync(sessionDbPath)) {
    failures.push(`Expected session db path to exist: ${sessionDbPath}`);
  }

  if (benchmarkCase.expectSessionDbPathCreated === false && existsSync(sessionDbPath)) {
    failures.push(`Expected session db path to remain absent: ${sessionDbPath}`);
  }

  return {
    caseId: benchmarkCase.id,
    iteration,
    ok: failures.length === 0,
    durationMs: Number(result.durationMs.toFixed(2)),
    command,
    envOverrides,
    sessionDbPath,
    stdoutPreview: result.stdout.split("\n").slice(0, 40).join("\n"),
    stderr: result.stderr.trim(),
    failures,
  };
}

const { benchmarksDir, resultsDir, repoRoot, tempDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave8-doctor-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

if (!Array.isArray(fixture.cases) || fixture.cases.length === 0) {
  fail("No Wave 8 doctor cases found in fixture.");
}

mkdirSync(tempDir, { recursive: true });

const runs = fixture.cases.map((benchmarkCase, index) =>
  runCaseIteration(benchmarkCase, index + 1, repoRoot, tempDir),
);

const failedRuns = runs.filter((run) => !run.ok);
const summary = {
  suiteId: fixture.suiteId ?? "wave8-doctor-gate",
  timestamp: new Date().toISOString(),
  totalRuns: runs.length,
  failedRuns: failedRuns.length,
};

mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave8-doctor-gate-latest.json");
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
  `Wave 8 doctor gate completed: ${summary.totalRuns} runs, failed ${summary.failedRuns}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (summary.failedRuns > 0) {
  process.exitCode = 1;
}
