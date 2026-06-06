import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const nodeBin = process.execPath;

const PROBE_CODE = `
import { rmSync } from "node:fs";
import { join } from "node:path";
import { SessionStore } from "@hotflow/sessions";
import { createCliControlPlane, createCliOperatorControlPlane } from "./dist/control-plane-adapter.js";
import { runCliDoctorViaControlPlane } from "./dist/doctor.js";

const tempDir = process.env.HF_WAVE23A_TEMP_DIR;
if (!tempDir) {
  throw new Error("Missing HF_WAVE23A_TEMP_DIR.");
}

const sessionId = "sess_status_probe";
const store = new SessionStore({
  dbPath: join(tempDir, "wave23a-operator.sqlite"),
});

try {
  store.createSession({ sessionId });
  store.appendJournal(sessionId, {
    eventType: "tasks.todo_write",
    payload: {
      items: [{ id: "todo_probe", content: "status snapshot todo", status: "todo" }],
    },
    createdAtMs: 100,
  });

  const controlPlane = createCliControlPlane({
    sessionStore: store,
  });
  const statusResult = await controlPlane.dispatch({
    type: "status",
    sessionId,
  });

  const operatorPlane = createCliOperatorControlPlane();
  const onboardingResult = await operatorPlane.dispatch({
    type: "onboarding-status",
    sessionId: "operator_surface",
  });

  const dispatchCalls = [];
  const report = await runCliDoctorViaControlPlane({
    sessionId: "operator_route",
    createControlPlane() {
      return {
        async dispatch(action) {
          dispatchCalls.push(action);
          return {
            ok: true,
            data: {
              status: "pass",
              checks: [],
            },
          };
        },
      };
    },
  });

  console.log(JSON.stringify({
    statusResult,
    onboardingResult,
    doctorRoute: {
      dispatchCalls,
      report,
    },
  }));
} finally {
  store.close();
  rmSync(tempDir, { recursive: true, force: true });
}
`;

function fail(message, details) {
  if (details) {
    process.stderr.write(`${message}\n${details}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

function runPnpm(repoRoot, args) {
  return spawnSync(pnpmBin, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
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

function runProbe(cliDir, tempDir) {
  const started = process.hrtime.bigint();
  const result = spawnSync(nodeBin, ["--input-type=module", "--eval", PROBE_CODE], {
    cwd: cliDir,
    encoding: "utf8",
    env: {
      ...process.env,
      HF_WAVE23A_TEMP_DIR: tempDir,
    },
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs,
  };
}

function coerceJson(output) {
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

function getCheckById(report, checkId) {
  if (!report || !Array.isArray(report.checks)) {
    return null;
  }
  return (
    report.checks.find((check) => {
      if (!check || typeof check !== "object") {
        return false;
      }
      return check.id === checkId;
    }) ?? null
  );
}

function compareExpectedReport(report, expectedReport) {
  const failures = [];

  if (typeof expectedReport.status === "string" && report?.status !== expectedReport.status) {
    failures.push(
      `Expected overall status ${expectedReport.status} but received ${report?.status ?? "(missing)"}.`,
    );
  }

  for (const expectedCheck of expectedReport.checks ?? []) {
    const actualCheck = getCheckById(report, expectedCheck.id);
    if (!actualCheck) {
      failures.push(`Missing check ${expectedCheck.id}.`);
      continue;
    }

    if (expectedCheck.status && actualCheck.status !== expectedCheck.status) {
      failures.push(
        `Expected check ${expectedCheck.id} status ${expectedCheck.status} but received ${actualCheck.status}.`,
      );
    }

    for (const needle of expectedCheck.includes ?? []) {
      const haystack = renderCheckForSearch(actualCheck);
      if (typeof needle === "string" && !haystack.includes(needle)) {
        failures.push(`Expected check ${expectedCheck.id} to include ${needle}.`);
      }
    }
  }

  return failures;
}

function compareJsonSubset(actual, expected, path = "root") {
  const failures = [];

  if (expected === null || typeof expected !== "object") {
    if (actual !== expected) {
      failures.push(
        `Expected ${path}=${JSON.stringify(expected)} but received ${JSON.stringify(actual)}.`,
      );
    }
    return failures;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      failures.push(`Expected ${path} to be an array.`);
      return failures;
    }
    if (actual.length < expected.length) {
      failures.push(`Expected ${path} length >= ${expected.length} but received ${actual.length}.`);
      return failures;
    }
    for (let index = 0; index < expected.length; index += 1) {
      failures.push(...compareJsonSubset(actual[index], expected[index], `${path}[${index}]`));
    }
    return failures;
  }

  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    failures.push(`Expected ${path} to be an object.`);
    return failures;
  }

  for (const [key, value] of Object.entries(expected)) {
    failures.push(...compareJsonSubset(actual[key], value, `${path}.${key}`));
  }
  return failures;
}

function toPreview(output, lines = 40) {
  return output.split("\n").slice(0, lines).join("\n");
}

function runDoctorCase(benchmarkCase, repoRoot, tempDir) {
  const sessionDbPath = resolve(tempDir, `${benchmarkCase.id}.sqlite`);
  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: repoRoot,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
    ...benchmarkCase.env,
  };
  const result = runHotflowCli(repoRoot, benchmarkCase.command ?? ["doctor", "--json"], env);
  const report = benchmarkCase.expectStructuredReport ? coerceJson(result.stdout) : null;
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
    failures.push(...compareExpectedReport(report, benchmarkCase.expectReport));
  }

  return {
    caseId: benchmarkCase.id,
    mode: benchmarkCase.mode,
    ok: failures.length === 0,
    durationMs: Number(result.durationMs.toFixed(2)),
    command: benchmarkCase.command ?? ["doctor", "--json"],
    stdoutPreview: toPreview(result.stdout),
    stderr: result.stderr.trim(),
    failures,
  };
}

function runProbeCase(benchmarkCase, cliDir) {
  const tempDir = mkdtempSync(join(tmpdir(), "hotflow-wave23a-probe-"));
  const result = runProbe(cliDir, tempDir);
  const payload = coerceJson(result.stdout);
  const failures = [];

  if (result.status !== benchmarkCase.expectStatus) {
    failures.push(
      `Expected exit status ${benchmarkCase.expectStatus} but received ${result.status}.`,
    );
  }
  if (!payload) {
    failures.push("Probe stdout was not valid JSON.");
  }
  if (payload && benchmarkCase.expectJsonSubset) {
    failures.push(...compareJsonSubset(payload, benchmarkCase.expectJsonSubset));
  }

  return {
    caseId: benchmarkCase.id,
    mode: benchmarkCase.mode,
    ok: failures.length === 0,
    durationMs: Number(result.durationMs.toFixed(2)),
    probe: "operator-surface",
    stdoutPreview: toPreview(result.stdout),
    stderr: result.stderr.trim(),
    failures,
  };
}

function runCase(benchmarkCase, paths) {
  if (benchmarkCase.mode === "doctor") {
    const tempDir = mkdtempSync(join(tmpdir(), "hotflow-wave23a-doctor-"));
    try {
      return runDoctorCase(benchmarkCase, paths.repoRoot, tempDir);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  if (benchmarkCase.mode === "probe") {
    return runProbeCase(benchmarkCase, resolve(paths.repoRoot, "apps", "cli"));
  }

  return {
    caseId: benchmarkCase.id,
    mode: benchmarkCase.mode,
    ok: false,
    durationMs: 0,
    failures: [`Unknown Wave 23a mode: ${String(benchmarkCase.mode)}`],
  };
}

const paths = getBenchmarksPaths();
const fixturePath = resolve(paths.benchmarksDir, "fixtures", "wave23a-operator-surface-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const iterations =
  Number.isSafeInteger(fixture.iterations) && fixture.iterations > 0 ? fixture.iterations : 1;

const buildResult = runPnpm(paths.repoRoot, ["--filter", "@hotflow/cli", "build"]);
if (buildResult.status !== 0) {
  fail(
    "Failed to build @hotflow/cli before Wave 23a operator surface gate.",
    `${buildResult.stderr}\n${buildResult.stdout}`,
  );
}

const runs = [];
for (let iteration = 0; iteration < iterations; iteration += 1) {
  for (const benchmarkCase of fixture.cases ?? []) {
    runs.push({
      iteration: iteration + 1,
      ...runCase(benchmarkCase, paths),
    });
  }
}

const summary = {
  totalRuns: runs.length,
  failedRuns: runs.filter((run) => !run.ok).length,
  passedRuns: runs.filter((run) => run.ok).length,
};

const report = {
  suiteId: typeof fixture.suiteId === "string" ? fixture.suiteId : "wave23a-operator-surface-gate",
  generatedAt: new Date().toISOString(),
  summary,
  runs,
};

mkdirSync(paths.resultsDir, { recursive: true });
const outputPath = resolve(paths.resultsDir, "wave23a-operator-surface-gate-latest.json");
writeFileSync(outputPath, JSON.stringify(report, null, 2));

process.stdout.write(
  `Wave 23a operator surface gate completed: ${summary.totalRuns} runs, failed ${summary.failedRuns}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (summary.failedRuns > 0) {
  process.exitCode = 1;
}
