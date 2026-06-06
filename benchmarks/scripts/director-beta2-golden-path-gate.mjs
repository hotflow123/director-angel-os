import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  getBenchmarksPaths,
  runHotflowCliCommand,
  runHotflowCliWithBuiltWorker as runHotflowCliWithBuiltWorkerCommand,
  runWorkspaceBuild,
} from "./cli-command.mjs";

const DIRECTOR_HOST_API_VERSION = "director-host-api.v1";
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const { benchmarksDir, repoRoot, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "director-beta2-golden-path-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

function fail(message, details) {
  if (details) {
    process.stderr.write(`${message}\n${details}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

function preview(output, lines = 30) {
  return String(output ?? "")
    .split("\n")
    .slice(0, lines)
    .join("\n");
}

function runBuild(target) {
  const result = runWorkspaceBuild(target);

  if (result.status !== 0) {
    fail(
      `Failed to build ${target} before Director Beta-2 golden path gate.`,
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
    );
  }
}

function compareSubset(actual, expected, path = "value") {
  const failures = [];

  if (expected === null || typeof expected !== "object" || Array.isArray(expected)) {
    if (actual !== expected) {
      failures.push(
        `Expected ${path}=${JSON.stringify(expected)} but received ${JSON.stringify(actual)}.`,
      );
    }
    return failures;
  }

  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
    failures.push(`Expected ${path} to be an object.`);
    return failures;
  }

  for (const [key, expectedValue] of Object.entries(expected)) {
    failures.push(...compareSubset(actual[key], expectedValue, `${path}.${key}`));
  }

  return failures;
}

function runHotflowCli(_repoRootPath, command, env) {
  return runHotflowCliCommand(command, env);
}

function runHotflowCliWithBuiltWorker(_repoRootPath, command, env) {
  return runHotflowCliWithBuiltWorkerCommand(command, env);
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

function verifyCliRun(run, label, needles) {
  const failures = [];

  if (run.status !== 0) {
    failures.push(`${label} exit status expected 0 but received ${run.status}.`);
  }

  for (const needle of needles) {
    if (!run.stdout.includes(needle)) {
      failures.push(`${label} stdout should include ${needle}.`);
    }
  }

  return failures;
}

function extractRunId(stdout) {
  const match = stdout.match(/run id:\s*([^\n\r]+)/u);
  return match?.[1]?.trim() ?? null;
}

async function requestJson(url, options = {}) {
  const { attempts = 3, retryDelayMs = 100, ...fetchOptions } = options;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers: {
          ...(fetchOptions.body === undefined ? {} : { "content-type": "application/json" }),
          ...(fetchOptions.headers ?? {}),
        },
      });

      const text = await response.text();
      const body = text.length === 0 ? null : JSON.parse(text);

      return {
        response,
        body,
      };
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }
      await delay(retryDelayMs * attempt);
    }
  }

  throw lastError;
}

async function reservePort(host = "127.0.0.1") {
  return await new Promise((resolvePort, rejectPort) => {
    const server = createNetServer();
    server.unref();
    server.once("error", rejectPort);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => rejectPort(new Error("Failed to reserve a TCP port.")));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          rejectPort(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function startDirectorHostApi(hostApiEnv) {
  const host = "127.0.0.1";
  const port = await reservePort(host);
  const baseUrl = `http://${host}:${port}`;
  const stdoutChunks = [];
  const stderrChunks = [];

  const child = spawn(pnpmBin, ["--filter", "@hotflow/director-host-api", "dev"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...hostApiEnv,
      DIRECTOR_HOST_API_HOST: host,
      DIRECTOR_HOST_API_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk) => {
    stdoutChunks.push(String(chunk));
  });
  child.stderr?.on("data", (chunk) => {
    stderrChunks.push(String(chunk));
  });

  const getLogs = () => ({
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
  });

  const waitForHealthy = async () => {
    const started = Date.now();

    while (Date.now() - started < 10000) {
      if (child.exitCode !== null) {
        const logs = getLogs();
        throw new Error(
          [
            `Director host API exited early with code ${child.exitCode}.`,
            logs.stdout.length > 0 ? `stdout:\n${logs.stdout}` : "",
            logs.stderr.length > 0 ? `stderr:\n${logs.stderr}` : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
        );
      }

      try {
        const { response } = await requestJson(`${baseUrl}/health`);
        if (response.ok) {
          return;
        }
      } catch {
        // Keep polling until the server is ready.
      }

      await delay(100);
    }

    const logs = getLogs();
    throw new Error(
      [
        `Timed out waiting for Director host API health at ${baseUrl}.`,
        logs.stdout.length > 0 ? `stdout:\n${logs.stdout}` : "",
        logs.stderr.length > 0 ? `stderr:\n${logs.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  };

  const close = async () => {
    if (child.exitCode !== null) {
      return;
    }

    child.kill("SIGTERM");
    const exited = await Promise.race([
      new Promise((resolveExit) => child.once("exit", () => resolveExit(true))),
      delay(3000, false),
    ]);

    if (exited === false && child.exitCode === null) {
      child.kill("SIGKILL");
      await Promise.race([
        new Promise((resolveExit) => child.once("exit", () => resolveExit(true))),
        delay(1000, false),
      ]);
    }
  };

  await waitForHealthy();

  return {
    baseUrl,
    close,
    getLogs,
  };
}

function requireRunPathEvidence(workspaceRoot, runId) {
  const base = join(workspaceRoot, ".director-angel", "runtime", "execution", "runs", runId);
  return {
    runPath: join(base, "run.json"),
    reportPath: join(base, "report.json"),
    eventsPath: join(base, "events.ndjson"),
  };
}

function assertFileExists(path, label, failures) {
  if (!existsSync(path)) {
    failures.push(`Missing ${label}: ${path}`);
  }
}

function getEventTypes(report) {
  return [...new Set((report.events ?? []).map((event) => event.type))];
}

async function runCase(benchmarkCase) {
  const started = process.hrtime.bigint();
  const workspaceRoot = mkdtempSync(join(tmpdir(), `director-beta2-${benchmarkCase.id}-`));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", `${benchmarkCase.id}.sqlite`);
  mkdirSync(join(dataDir, "sessions"), { recursive: true });

  const blueprintPath = join(workspaceRoot, "blueprint.json");
  writeFileSync(blueprintPath, JSON.stringify(benchmarkCase.reviewedBlueprint, null, 2));

  const providerId = "scripted";
  const runtimeEnv = {
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_DEFAULT_PROVIDER: providerId,
    HOTFLOW_DEFAULT_MODEL: "hotflow-phase1",
  };
  const cliEnv = {
    ...process.env,
    ...runtimeEnv,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
  };

  const failures = [];
  const commandRuns = {};
  let hostApi = null;

  try {
    hostApi = await startDirectorHostApi(runtimeEnv);

    commandRuns.create = runHotflowCli(
      repoRoot,
      ["director", "run", "create", "--input", blueprintPath, "--host", hostApi.baseUrl],
      cliEnv,
    );
    failures.push(
      ...verifyCliRun(commandRuns.create, "director run create", [
        "Director run:",
        `status: ${benchmarkCase.expectedRun.createdStatus}`,
      ]),
    );
    if (
      (benchmarkCase.reviewedBlueprint.actionGraph?.nodes?.length ?? 0) <
      (benchmarkCase.expectedRun.minimumAssignmentCount ?? 0)
    ) {
      failures.push(
        `Reviewed blueprint assignment count expected >= ${benchmarkCase.expectedRun.minimumAssignmentCount} but received ${benchmarkCase.reviewedBlueprint.actionGraph?.nodes?.length ?? 0}.`,
      );
    }

    const runId = extractRunId(commandRuns.create.stdout);
    if (!runId) {
      failures.push("Could not extract run id from director run create output.");
    }

    const runIdValue = runId ?? "missing-run-id";

    commandRuns.statusCreated = runHotflowCli(
      repoRoot,
      ["director", "run", "status", "--run-id", runIdValue, "--host", hostApi.baseUrl],
      cliEnv,
    );
    failures.push(
      ...verifyCliRun(commandRuns.statusCreated, "director run status (created)", [
        "Director run:",
        `status: ${benchmarkCase.expectedRun.createdStatus}`,
      ]),
    );

    commandRuns.start = runHotflowCli(
      repoRoot,
      ["director", "run", "start", "--run-id", runIdValue, "--host", hostApi.baseUrl],
      cliEnv,
    );
    failures.push(
      ...verifyCliRun(commandRuns.start, "director run start", [
        "Director run:",
        `status: ${benchmarkCase.expectedRun.runningStatus}`,
      ]),
    );

    commandRuns.pause = runHotflowCli(
      repoRoot,
      ["director", "run", "pause", "--run-id", runIdValue, "--host", hostApi.baseUrl],
      cliEnv,
    );
    failures.push(
      ...verifyCliRun(commandRuns.pause, "director run pause", [
        "Director run:",
        `status: ${benchmarkCase.expectedRun.pausedStatus}`,
      ]),
    );

    commandRuns.workerPaused = await runHotflowCliWithBuiltWorker(
      repoRoot,
      ["director", "run", "once", "--run-id", runIdValue, "--worker-id", "bench-beta2-paused"],
      cliEnv,
    );
    const pausedWorkerPayload = coerceJson(commandRuns.workerPaused.stdout);
    if (commandRuns.workerPaused.status !== 0) {
      failures.push(
        `director run once paused pass exit status expected 0 but received ${commandRuns.workerPaused.status}.`,
      );
    }
    if (!pausedWorkerPayload) {
      failures.push("director run once paused pass did not emit valid JSON.");
    } else {
      if (pausedWorkerPayload.status !== benchmarkCase.expectedPausedWorker.status) {
        failures.push(
          `Expected paused worker status ${benchmarkCase.expectedPausedWorker.status} but received ${pausedWorkerPayload.status}.`,
        );
      }
      if (
        !Array.isArray(pausedWorkerPayload.executedAssignments) ||
        pausedWorkerPayload.executedAssignments.length !==
          benchmarkCase.expectedPausedWorker.executedAssignments
      ) {
        failures.push(
          `Expected paused worker executedAssignments=${benchmarkCase.expectedPausedWorker.executedAssignments} but received ${pausedWorkerPayload.executedAssignments?.length ?? "(missing)"}.`,
        );
      }
      for (const flag of benchmarkCase.expectedPausedWorker.requiredFlags ?? []) {
        if (!pausedWorkerPayload.flags?.includes(flag)) {
          failures.push(`Paused worker report missing flag ${flag}.`);
        }
      }
    }

    commandRuns.resume = runHotflowCli(
      repoRoot,
      ["director", "run", "resume", "--run-id", runIdValue, "--host", hostApi.baseUrl],
      cliEnv,
    );
    failures.push(
      ...verifyCliRun(commandRuns.resume, "director run resume", [
        "Director run:",
        `status: ${benchmarkCase.expectedRun.runningStatus}`,
      ]),
    );

    commandRuns.worker = await runHotflowCliWithBuiltWorker(
      repoRoot,
      ["director", "run", "once", "--run-id", runIdValue, "--worker-id", "bench-beta2-worker"],
      cliEnv,
    );
    const workerPayload = coerceJson(commandRuns.worker.stdout);
    if (commandRuns.worker.status !== 0) {
      failures.push(
        `director run once completion pass exit status expected 0 but received ${commandRuns.worker.status}.`,
      );
    }
    if (!workerPayload) {
      failures.push("director run once completion pass did not emit valid JSON.");
    } else {
      if (workerPayload.status !== benchmarkCase.expectedRun.completedStatus) {
        failures.push(
          `Expected worker completion status ${benchmarkCase.expectedRun.completedStatus} but received ${workerPayload.status}.`,
        );
      }
      if (
        !Array.isArray(workerPayload.executedAssignments) ||
        workerPayload.executedAssignments.length === 0
      ) {
        failures.push("director run once completion pass should execute at least one assignment.");
      }
      for (const flag of benchmarkCase.expectedRun.requiredFlags ?? []) {
        if (!workerPayload.flags?.includes(flag)) {
          failures.push(`Completed worker report missing flag ${flag}.`);
        }
      }
    }

    commandRuns.statusCompleted = runHotflowCli(
      repoRoot,
      ["director", "run", "status", "--run-id", runIdValue, "--host", hostApi.baseUrl],
      cliEnv,
    );
    failures.push(
      ...verifyCliRun(commandRuns.statusCompleted, "director run status (completed)", [
        "Director run:",
        `status: ${benchmarkCase.expectedRun.completedStatus}`,
      ]),
    );

    commandRuns.report = runHotflowCli(
      repoRoot,
      ["director", "run", "report", "--run-id", runIdValue, "--host", hostApi.baseUrl],
      cliEnv,
    );
    failures.push(
      ...verifyCliRun(commandRuns.report, "director run report", [
        "Director run report:",
        `status: ${benchmarkCase.expectedRun.completedStatus}`,
      ]),
    );

    const finalRunResult = await requestJson(
      `${hostApi.baseUrl}/v1/runs/${encodeURIComponent(runIdValue)}`,
    );
    if (!finalRunResult.response.ok) {
      failures.push(`/v1/runs/:runId failed (${finalRunResult.response.status}).`);
    } else {
      failures.push(
        ...compareSubset(finalRunResult.body, {
          status: benchmarkCase.expectedRun.completedStatus,
        }),
      );
      if (
        !finalRunResult.body.assignments?.every((assignment) => assignment.status === "completed")
      ) {
        failures.push("Expected all assignments to be completed in the final run.");
      }
      if (
        !finalRunResult.body.assignments?.every(
          (assignment) => assignment.result?.status === "completed",
        )
      ) {
        failures.push("Expected every completed assignment to carry a completed result payload.");
      }
    }

    const reportResult = await requestJson(
      `${hostApi.baseUrl}/v1/runs/${encodeURIComponent(runIdValue)}/report`,
    );
    if (!reportResult.response.ok) {
      failures.push(`/v1/runs/:runId/report failed (${reportResult.response.status}).`);
    } else {
      failures.push(
        ...compareSubset(reportResult.body, {
          run: {
            status: benchmarkCase.expectedRun.completedStatus,
          },
        }),
      );
      for (const flag of benchmarkCase.expectedRun.requiredFlags ?? []) {
        if (!reportResult.body.flags?.includes(flag)) {
          failures.push(`Run report missing flag ${flag}.`);
        }
      }
      if (
        (reportResult.body.events?.length ?? 0) < (benchmarkCase.expectedRun.minimumEventCount ?? 0)
      ) {
        failures.push(
          `Run report event count expected >= ${benchmarkCase.expectedRun.minimumEventCount} but received ${reportResult.body.events?.length ?? 0}.`,
        );
      }
      const eventTypes = getEventTypes(reportResult.body);
      for (const eventType of benchmarkCase.expectedRun.requiredEventTypes ?? []) {
        if (!eventTypes.includes(eventType)) {
          failures.push(`Run report missing event type ${eventType}.`);
        }
      }
    }

    const evidencePaths = requireRunPathEvidence(workspaceRoot, runIdValue);
    assertFileExists(evidencePaths.runPath, "execution run file", failures);
    assertFileExists(evidencePaths.reportPath, "execution report file", failures);
    assertFileExists(evidencePaths.eventsPath, "execution event log", failures);

    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    return {
      caseId: benchmarkCase.id,
      ok: failures.length === 0,
      durationMs: Number(durationMs.toFixed(2)),
      workspaceRoot,
      runId: runIdValue,
      blueprintPath,
      evidencePaths,
      checks: {
        hostUrl: hostApi.baseUrl,
        assignmentCount: finalRunResult.body?.assignments?.length ?? null,
        finalStatus: finalRunResult.body?.status ?? null,
        reportEventCount: reportResult.body?.events?.length ?? null,
      },
      commandRuns: Object.fromEntries(
        Object.entries(commandRuns).map(([key, run]) => [
          key,
          {
            status: run.status,
            durationMs: run.durationMs,
            stdoutPreview: preview(run.stdout),
            stderr: run.stderr.trim(),
          },
        ]),
      ),
      failures,
    };
  } catch (error) {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    return {
      caseId: benchmarkCase.id,
      ok: false,
      durationMs: Number(durationMs.toFixed(2)),
      workspaceRoot,
      failures: [String(error)],
      commandRuns,
    };
  } finally {
    if (hostApi) {
      await hostApi.close();
    }
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

runBuild("@hotflow/director-worker");

const runs = [];
for (const benchmarkCase of fixture.cases ?? []) {
  // eslint-disable-next-line no-await-in-loop
  runs.push(await runCase(benchmarkCase));
}

const summary = {
  totalRuns: runs.length,
  failedRuns: runs.filter((run) => !run.ok).length,
  passedRuns: runs.filter((run) => run.ok).length,
};

const report = {
  suiteId:
    typeof fixture.suiteId === "string" ? fixture.suiteId : "director-beta2-golden-path-gate",
  generatedAt: new Date().toISOString(),
  summary,
  runs,
};

mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "director-beta2-golden-path-gate-latest.json");
writeFileSync(outputPath, JSON.stringify(report, null, 2));

process.stdout.write(
  `Director Beta-2 golden path gate completed: ${summary.totalRuns} runs, failed ${summary.failedRuns}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (summary.failedRuns > 0) {
  process.exitCode = 1;
}
