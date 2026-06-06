import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const PROBE_CODE = `
import { runCliOnboardViaControlPlane } from "../src/onboard.ts";

const dispatchCalls = [];
const report = await runCliOnboardViaControlPlane({
  sessionId: "operator_route",
  controlPlane: {
    async dispatch(action) {
      dispatchCalls.push(action);
      return {
        ok: true,
        data: {
          status: "pass",
          sessionId: "operator_route",
          summaryText: "probe onboarding pass",
          doctor: {
            status: "pass",
            counts: {
              pass: 0,
              warn: 0,
              fail: 0,
              total: 0,
            },
            checks: [],
          },
          nextSteps: [],
        },
      };
    },
  },
});

console.log(
  JSON.stringify({
    dispatchCalls,
    report,
  }),
);
`;

function fail(message, details) {
  if (details) {
    process.stderr.write(`${message}\n${details}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
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

function runProbe(cliDir) {
  const probeDir = join(cliDir, ".tmp");
  const probePath = join(probeDir, `wave23b-onboarding-probe-${process.pid}.ts`);
  mkdirSync(probeDir, { recursive: true });
  writeFileSync(probePath, PROBE_CODE, "utf8");

  const started = process.hrtime.bigint();
  const result = spawnSync(
    pnpmBin,
    ["exec", "tsx", "--tsconfig", "./tsconfig.dev.json", probePath],
    {
      cwd: cliDir,
      encoding: "utf8",
      env: process.env,
    },
  );
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  rmSync(probePath, { force: true });

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

function selectReportTarget(payload, reportTarget) {
  if (!reportTarget || reportTarget === "root") {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return payload[reportTarget] ?? null;
}

function createHealthyDirectorAssignment(overrides = {}) {
  return {
    runId: "run-1",
    assignmentId: "assignment-script-1",
    role: "script-planner",
    objective: "Draft the lighthouse reveal script",
    deliverable: "script outline",
    inputs: ["goal"],
    outputs: ["script outline"],
    acceptanceCriteria: ["Bridge request is accepted."],
    constraints: [],
    actionClass: "generate",
    approvalMode: "auto_allow",
    dependsOn: [],
    status: "completed",
    selectedAdapter: "seedance-preview",
    allowedAdapters: ["seedance-preview"],
    createdAt: "2026-04-13T12:06:00.000Z",
    completedAt: "2026-04-13T12:10:00.000Z",
    notes: ["external-bridge", "bridge:http-json"],
    result: {
      runId: "run-1",
      assignmentId: "assignment-script-1",
      status: "completed",
      recordedAt: "2026-04-13T12:10:00.000Z",
      workerId: "worker-script-1",
      summary: "Bridge request accepted.",
      adapterId: "seedance-preview",
      bridgeExecution: {
        kind: "http-json",
        request: {
          endpointOrigin: "https://bridge.example.test",
          endpointPath: "/v1/jobs",
          method: "POST",
          timeoutMs: 1500,
          authMode: "env",
          headerKeys: ["authorization"],
          payloadBytes: 256,
        },
        response: {
          statusCode: 202,
          accepted: true,
          requestId: "req-beta9-pass",
          bodyBytes: 48,
        },
      },
    },
    ...overrides,
  };
}

function createDirectorExecutionRunArtifact(overrides = {}) {
  return {
    schemaVersion: "director.execution.run.v1",
    runId: "run-1",
    snapshotId: "snapshot-1",
    runtimeId: "director-host-api",
    blueprintId: "blueprint-1",
    handoffId: "handoff-1",
    actionGraphId: "graph-1",
    goal: "Generate a single-shot lighthouse reveal video.",
    previewSummary: "Single-shot video brief is ready for remote submission.",
    sideEffectsAllowed: true,
    createdAt: "2026-04-13T12:05:00.000Z",
    updatedAt: "2026-04-13T12:10:00.000Z",
    status: "completed",
    assignments: [createHealthyDirectorAssignment()],
    events: [],
    notes: ["external-bridge-succeeded"],
    ...overrides,
  };
}

function createDirectorExecutionReportArtifact(overrides = {}) {
  return {
    schemaVersion: "director.execution.run.v1",
    reportId: "report-run-1",
    runId: "run-1",
    run: createDirectorExecutionRunArtifact(),
    recordedAt: "2026-04-13T12:11:00.000Z",
    summary: ["run status=completed"],
    flags: ["external-bridge-succeeded"],
    operatorSurface: {
      directorGoal: "Generate a single-shot lighthouse reveal video.",
      operatorSummary: "Single-shot video brief is ready for remote submission.",
      adapterRoute: "seedance-preview",
      bridgeVerdict: "accepted",
      requestAccepted: true,
      requestId: "req-beta9-pass",
      nextAction: "track the remote request by request id and wait for the downstream result.",
    },
    events: [],
    ...overrides,
  };
}

function seedDirectorExecutionArtifacts(workspaceRoot, seedKind) {
  if (seedKind !== "reroutable_warn") {
    return;
  }

  const runtimeDir = join(workspaceRoot, ".director-angel", "runtime");
  const executionRunDir = join(runtimeDir, "execution", "runs", "run-warn-1");

  for (const dir of [
    join(workspaceRoot, ".director-angel"),
    join(workspaceRoot, ".director-angel", "knowledge"),
    join(workspaceRoot, ".director-angel", "knowledge", "candidate"),
    join(workspaceRoot, ".director-angel", "knowledge", "review"),
    join(workspaceRoot, ".director-angel", "knowledge", "published"),
    join(workspaceRoot, ".director-angel", "knowledge", "history"),
    join(workspaceRoot, ".director-angel", "knowledge", "rollback"),
    join(workspaceRoot, ".director-angel", "adapters"),
    join(workspaceRoot, ".director-angel", "adapters", "registry"),
    runtimeDir,
    join(runtimeDir, "proposals"),
    join(runtimeDir, "execution"),
    join(runtimeDir, "execution", "runs"),
    executionRunDir,
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  const warnRun = createDirectorExecutionRunArtifact({
    runId: "run-warn-1",
    updatedAt: "2026-04-13T12:40:00.000Z",
    status: "failed",
    assignments: [
      createHealthyDirectorAssignment({
        runId: "run-warn-1",
        assignmentId: "assignment-rerouted-1",
        status: "ready",
        selectedAdapter: "runway-preview",
        allowedAdapters: ["seedance-preview", "runway-preview"],
        createdAt: "2026-04-13T12:20:00.000Z",
        completedAt: undefined,
        notes: [
          "external-bridge",
          "bridge:http-json",
          "Retry requested at 2026-04-13T12:30:00.000Z.",
          "Adapter rerouted from seedance-preview to runway-preview at 2026-04-13T12:31:00.000Z.",
        ],
        result: undefined,
      }),
      createHealthyDirectorAssignment({
        runId: "run-warn-1",
        assignmentId: "assignment-failed-1",
        status: "failed",
        selectedAdapter: "seedance-preview",
        allowedAdapters: ["seedance-preview", "runway-preview"],
        createdAt: "2026-04-13T12:21:00.000Z",
        completedAt: undefined,
        notes: [
          "external-bridge",
          "bridge:http-json",
          "Retry requested at 2026-04-13T12:32:00.000Z.",
        ],
        result: {
          runId: "run-warn-1",
          assignmentId: "assignment-failed-1",
          status: "failed",
          recordedAt: "2026-04-13T12:33:00.000Z",
          workerId: "worker-failed-1",
          summary: "Bridge request failed with retry budget exhausted on the current route.",
          adapterId: "seedance-preview",
          bridgeExecution: {
            kind: "http-json",
            request: {
              endpointOrigin: "https://bridge.example.test",
              endpointPath: "/v1/jobs",
              method: "POST",
              timeoutMs: 1500,
              authMode: "env",
              headerKeys: ["authorization"],
              payloadBytes: 256,
            },
            failure: {
              reason: "http_error",
              retryable: true,
              statusCode: 502,
              message: "Bad gateway",
            },
          },
        },
      }),
    ],
  });

  writeFileSync(join(executionRunDir, "run.json"), JSON.stringify(warnRun), "utf8");
  writeFileSync(
    join(executionRunDir, "report.json"),
    JSON.stringify(
      createDirectorExecutionReportArtifact({
        reportId: "report-warn-1",
        runId: "run-warn-1",
        run: warnRun,
        recordedAt: "2026-04-13T12:41:00.000Z",
        summary: ["run status=failed", "route recovery in progress"],
        flags: ["external-bridge-failed", "route-recovery-in-progress"],
        operatorSurface: {
          directorGoal: "Generate a single-shot lighthouse reveal video.",
          operatorSummary: "One assignment has been rerouted and one still needs manual reroute.",
          adapterRoute: "runway-preview",
          bridgeVerdict: "failed",
          bridgeFailureReason: "http_error",
          retryable: true,
          retryAllowed: false,
          rerouteCandidates: ["runway-preview"],
          nextAction: "reroute the failed assignment to the approved alternate adapter and retry.",
        },
      }),
    ),
    "utf8",
  );
}

function runOnboardCase(benchmarkCase, repoRoot, tempRoot) {
  const workspaceRoot = benchmarkCase.freshWorkspace
    ? mkdtempSync(join(tempRoot, `${benchmarkCase.id}-workspace-`))
    : repoRoot;
  if (typeof benchmarkCase.seedDirectorExecution === "string") {
    seedDirectorExecutionArtifacts(workspaceRoot, benchmarkCase.seedDirectorExecution);
  }
  const sessionDbPath = resolve(tempRoot, `${benchmarkCase.id}.sqlite`);
  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
    ...benchmarkCase.env,
  };
  const result = runHotflowCli(repoRoot, benchmarkCase.command ?? ["onboard", "--json"], env);
  const payload = benchmarkCase.expectStructuredReport ? coerceJson(result.stdout) : null;
  const failures = [];

  if (result.status !== benchmarkCase.expectStatus) {
    failures.push(
      `Expected exit status ${benchmarkCase.expectStatus} but received ${result.status}.`,
    );
  }
  if (benchmarkCase.expectStructuredReport && !payload) {
    failures.push("Expected JSON onboarding report but stdout was not valid JSON.");
  }

  const reportTarget = selectReportTarget(payload, benchmarkCase.reportTarget ?? "root");
  if (reportTarget && benchmarkCase.expectReport) {
    failures.push(...compareExpectedReport(reportTarget, benchmarkCase.expectReport));
  }
  if (payload && benchmarkCase.expectJsonSubset) {
    failures.push(...compareJsonSubset(payload, benchmarkCase.expectJsonSubset));
  }

  if (benchmarkCase.freshWorkspace) {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }

  return {
    caseId: benchmarkCase.id,
    mode: benchmarkCase.mode,
    ok: failures.length === 0,
    durationMs: Number(result.durationMs.toFixed(2)),
    command: benchmarkCase.command ?? ["onboard", "--json"],
    stdoutPreview: toPreview(result.stdout),
    stderr: result.stderr.trim(),
    failures,
  };
}

function runProbeCase(benchmarkCase, cliDir) {
  const result = runProbe(cliDir);
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
    probe: "onboarding-route",
    stdoutPreview: toPreview(result.stdout),
    stderr: result.stderr.trim(),
    failures,
  };
}

function runCase(benchmarkCase, paths) {
  if (benchmarkCase.mode === "onboard") {
    const tempRoot = mkdtempSync(join(tmpdir(), "hotflow-wave23b-onboard-"));
    try {
      return runOnboardCase(benchmarkCase, paths.repoRoot, tempRoot);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
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
    failures: [`Unknown Wave 23b mode: ${String(benchmarkCase.mode)}`],
  };
}

const paths = getBenchmarksPaths();
const fixturePath = resolve(paths.benchmarksDir, "fixtures", "wave23b-onboarding-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const iterations =
  Number.isSafeInteger(fixture.iterations) && fixture.iterations > 0 ? fixture.iterations : 1;

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
  suiteId: typeof fixture.suiteId === "string" ? fixture.suiteId : "wave23b-onboarding-gate",
  generatedAt: new Date().toISOString(),
  summary,
  runs,
};

mkdirSync(paths.resultsDir, { recursive: true });
const outputPath = resolve(paths.resultsDir, "wave23b-onboarding-gate-latest.json");
writeFileSync(outputPath, JSON.stringify(report, null, 2));

process.stdout.write(
  `Wave 23b onboarding gate completed: ${summary.totalRuns} runs, failed ${summary.failedRuns}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (summary.failedRuns > 0) {
  process.exitCode = 1;
}
