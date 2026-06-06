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
    .replaceAll("{{sessionDbPath}}", context.sessionDbPath)
    .replaceAll("{{unreachableBaseUrl}}", context.unreachableBaseUrl);
}

function runHotflowCli(repoRoot, command, env) {
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

function getCheckByCandidateIds(report, candidateIds) {
  if (!report || !Array.isArray(report.checks) || candidateIds.length === 0) {
    return null;
  }
  return (
    report.checks.find((check) => {
      if (!check || typeof check !== "object") {
        return false;
      }
      const id = typeof check.id === "string" ? check.id : "";
      return candidateIds.includes(id);
    }) ?? null
  );
}

function normalizeExpectedIds(expectedCheck) {
  if (Array.isArray(expectedCheck.idsAnyOf)) {
    return expectedCheck.idsAnyOf.filter((value) => typeof value === "string");
  }
  if (typeof expectedCheck.id === "string") {
    return [expectedCheck.id];
  }
  return [];
}

function compareExpectedReport(report, expectedReport, context) {
  const failures = [];

  const expectedOverall = expectedReport.overall ?? expectedReport.status;
  if (typeof expectedOverall === "string" && report?.status !== expectedOverall) {
    failures.push(
      `Expected overall/status ${expectedOverall} but received ${report?.status ?? "(missing)"}.`,
    );
  }

  if (Array.isArray(expectedReport.checks)) {
    for (const expectedCheck of expectedReport.checks) {
      const expectedIds = normalizeExpectedIds(expectedCheck);
      if (expectedIds.length === 0) {
        failures.push("Expected check entry missing id/idsAnyOf.");
        continue;
      }

      const actualCheck = getCheckByCandidateIds(report, expectedIds);
      if (!actualCheck) {
        failures.push(`Missing check ${expectedIds.join(" | ")}.`);
        continue;
      }

      if (expectedCheck.status && actualCheck.status !== expectedCheck.status) {
        failures.push(
          `Expected check ${expectedIds.join(" | ")} status ${expectedCheck.status} but received ${actualCheck.status}.`,
        );
      }

      if (Array.isArray(expectedCheck.includes)) {
        const haystack = renderCheckForSearch(actualCheck);
        for (const rawNeedle of expectedCheck.includes) {
          const needle = applyTokens(rawNeedle, context);
          if (typeof needle === "string" && !haystack.includes(needle)) {
            failures.push(`Expected check ${expectedIds.join(" | ")} to include ${needle}.`);
          }
        }
      }
    }
  }

  return failures;
}

function compareExpectedOutput(output, expectedIncludes, context, streamName) {
  const failures = [];
  for (const rawNeedle of expectedIncludes ?? []) {
    const needle = applyTokens(rawNeedle, context);
    if (typeof needle === "string" && !output.includes(needle)) {
      failures.push(`Expected ${streamName} to include ${needle}.`);
    }
  }
  return failures;
}

function buildRunEnv(repoRoot, context, envOverrides) {
  return {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: repoRoot,
    HOTFLOW_CLI_SESSION_DB_PATH: context.sessionDbPath,
    HOTFLOW_DEFAULT_PROVIDER: "scripted",
    HOTFLOW_DEFAULT_MODEL: "hotflow-phase1",
    ...envOverrides,
  };
}

function runDoctorCase(benchmarkCase, repoRoot, context, envOverrides) {
  const command = Array.isArray(benchmarkCase.command)
    ? benchmarkCase.command.map((token) => applyTokens(token, context))
    : ["doctor", "--json"];

  const result = runHotflowCli(repoRoot, command, buildRunEnv(repoRoot, context, envOverrides));
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

  return {
    caseId: benchmarkCase.id,
    mode: benchmarkCase.mode,
    ok: failures.length === 0,
    durationMs: Number(result.durationMs.toFixed(2)),
    command,
    envOverrides,
    stdoutPreview: result.stdout.split("\n").slice(0, 40).join("\n"),
    stderr: result.stderr.trim(),
    failures,
  };
}

function runEngineBoundaryCase(benchmarkCase, repoRoot, context, envOverrides) {
  const command = Array.isArray(benchmarkCase.command)
    ? benchmarkCase.command.map((token) => applyTokens(token, context))
    : [];
  const result = runHotflowCli(repoRoot, command, buildRunEnv(repoRoot, context, envOverrides));
  const failures = [];

  if (result.status !== benchmarkCase.expectStatus) {
    failures.push(
      `Expected exit status ${benchmarkCase.expectStatus} but received ${result.status}.`,
    );
  }

  failures.push(
    ...compareExpectedOutput(result.stdout, benchmarkCase.expectStdoutIncludes, context, "stdout"),
  );
  failures.push(
    ...compareExpectedOutput(result.stderr, benchmarkCase.expectStderrIncludes, context, "stderr"),
  );

  return {
    caseId: benchmarkCase.id,
    mode: benchmarkCase.mode,
    ok: failures.length === 0,
    durationMs: Number(result.durationMs.toFixed(2)),
    command,
    envOverrides,
    stdoutPreview: result.stdout.split("\n").slice(0, 60).join("\n"),
    stderr: result.stderr.trim(),
    failures,
  };
}

function runCase(benchmarkCase, repoRoot, tempDir, iteration) {
  const sessionDbPath = resolve(tempDir, `wave22-${benchmarkCase.id}-${iteration}.sqlite`);
  const context = {
    tempDir,
    sessionDbPath,
    unreachableBaseUrl: "http://127.0.0.1:9",
  };
  const envOverrides = {};
  for (const [key, rawValue] of Object.entries(benchmarkCase.env ?? {})) {
    envOverrides[key] = applyTokens(rawValue, context);
  }

  if (benchmarkCase.mode === "doctor") {
    return runDoctorCase(benchmarkCase, repoRoot, context, envOverrides);
  }
  if (benchmarkCase.mode === "run") {
    return runEngineBoundaryCase(benchmarkCase, repoRoot, context, envOverrides);
  }

  return {
    caseId: benchmarkCase.id,
    mode: benchmarkCase.mode,
    ok: false,
    durationMs: 0,
    command: [],
    envOverrides,
    stdoutPreview: "",
    stderr: "",
    failures: [`Unsupported case mode: ${benchmarkCase.mode}`],
  };
}

const { benchmarksDir, resultsDir, repoRoot, tempDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave22-mempalace-boundary-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const iterations = Number.isFinite(fixture.iterations) ? Number(fixture.iterations) : 1;

if (!Array.isArray(fixture.cases) || fixture.cases.length === 0) {
  fail("No Wave 22 mempalace boundary cases found in fixture.");
}

mkdirSync(tempDir, { recursive: true });

const runs = [];
for (let iteration = 1; iteration <= iterations; iteration += 1) {
  for (const benchmarkCase of fixture.cases) {
    runs.push(runCase(benchmarkCase, repoRoot, tempDir, iteration));
  }
}

const failedRuns = runs.filter((run) => !run.ok);
mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave22-mempalace-boundary-gate-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId: fixture.suiteId ?? "wave22-mempalace-boundary-gate",
        timestamp: new Date().toISOString(),
        totalRuns: runs.length,
        failedRuns: failedRuns.length,
      },
      runs,
    },
    null,
    2,
  ),
);

process.stdout.write(
  `Wave 22 mempalace boundary gate completed: ${runs.length} runs, failed ${failedRuns.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (failedRuns.length > 0) {
  process.exitCode = 1;
}

if (!existsSync(outputPath)) {
  fail("Expected benchmark report output file to exist.", outputPath);
}
