import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { getBenchmarksPaths, runHotflowCliCommand } from "./cli-command.mjs";

const DIRECTOR_HOST_API_VERSION = "director-host-api.v1";
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const { benchmarksDir, repoRoot, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "director-beta1-golden-path-gate.json");
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

function extractRoleNode(nodes, role) {
  return nodes.find((node) => node.role === role) ?? null;
}

function verifyCliRun(run, label, needle) {
  const failures = [];

  if (run.status !== 0) {
    failures.push(`${label} exit status expected 0 but received ${run.status}.`);
  }

  if (!run.stdout.includes(needle)) {
    failures.push(`${label} stdout should include ${needle}.`);
  }

  return failures;
}

function buildIntake(snapshot) {
  const objective =
    snapshot.project.outline ??
    snapshot.project.title ??
    `${snapshot.group.generationType} plan for ${snapshot.group.groupId}`;

  return {
    intakeId: `intake-${snapshot.snapshotId}`,
    submittedAt: snapshot.createdAt,
    objective,
    desiredOutcome: snapshot.project.outline,
    deliverables: [`${snapshot.group.generationType} blueprint for ${snapshot.group.groupId}`],
    constraints: (snapshot.locks?.lockedFields ?? []).map((lock) => ({
      field: lock.field,
      requirement: lock.reason ?? "Respect the locked field during director planning.",
      priority: lock.level === "hard_lock" ? "required" : "preferred",
      ...(lock.reason === undefined ? {} : { rationale: lock.reason }),
    })),
    notes: ["Benchmark synthesized intake payload for Director Angel Beta-1."],
  };
}

function buildAlignmentLock(snapshot, intake) {
  return {
    lockId: `lock-${snapshot.snapshotId}`,
    sourceIntakeId: intake.intakeId,
    state: "locked",
    lockedAt: snapshot.createdAt,
    objective: intake.objective,
    ...(intake.desiredOutcome === undefined ? {} : { desiredOutcome: intake.desiredOutcome }),
    deliverables: intake.deliverables ?? [],
    lockedConstraints: intake.constraints ?? [],
    lockedFields: snapshot.locks?.lockedFields ?? [],
    notes: ["Benchmark synthesized alignment lock for Director Angel Beta-1."],
  };
}

function runHotflowCli(_repoRootPath, command, env) {
  return runHotflowCliCommand(command, env);
}

function parseStatusObservationCount(stdout) {
  const match = stdout.match(/observation records:\s*(\d+)/u);
  return match ? Number.parseInt(match[1], 10) : null;
}

async function waitForObservationFile(path, minimumLines, timeoutMs = 5000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    try {
      const lines = readFileSync(path, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (lines.length >= minimumLines) {
        return lines.map((line) => JSON.parse(line));
      }
    } catch {
      // Ignore until the file appears.
    }
    await delay(50);
  }

  throw new Error(`Observation file did not reach ${minimumLines} records in time.`);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  const body = text.length === 0 ? null : JSON.parse(text);

  return {
    response,
    body,
  };
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
    host,
    port,
  };
}

async function runCase(benchmarkCase) {
  const started = process.hrtime.bigint();
  const workspaceRoot = mkdtempSync(join(tmpdir(), `director-beta1-${benchmarkCase.id}-`));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", `${benchmarkCase.id}.sqlite`);
  const observationPath = join(workspaceRoot, ".director-angel", "runtime", "observations.ndjson");
  const expectedObservationCount = 8;

  mkdirSync(join(dataDir, "sessions"), { recursive: true });

  const clarifySnapshotPath = join(workspaceRoot, "snapshot-needs-clarify.json");
  const readySnapshotPath = join(workspaceRoot, "snapshot-ready.json");
  const outcomePath = join(workspaceRoot, "outcome.json");
  writeFileSync(clarifySnapshotPath, JSON.stringify(benchmarkCase.clarifySnapshot, null, 2));
  writeFileSync(readySnapshotPath, JSON.stringify(benchmarkCase.readySnapshot, null, 2));

  const providerId = benchmarkCase.providerIds[0] ?? "scripted";
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
  const apiChecks = {};
  const cliRuns = {};
  let hostApi = null;

  try {
    hostApi = await startDirectorHostApi(runtimeEnv);
    apiChecks.hostUrl = hostApi.baseUrl;

    const runtimeResult = await requestJson(`${hostApi.baseUrl}/v1/runtime`);
    if (!runtimeResult.response.ok) {
      failures.push(`/v1/runtime failed (${runtimeResult.response.status}).`);
    } else {
      failures.push(
        ...compareSubset(runtimeResult.body, {
          apiVersion: DIRECTOR_HOST_API_VERSION,
          runtimeId: "director-host-api",
        }),
      );
      apiChecks.runtimeId = runtimeResult.body?.runtimeId ?? null;
    }

    const clarifyIntake = buildIntake(benchmarkCase.clarifySnapshot);
    const intakeResult = await requestJson(`${hostApi.baseUrl}/v1/intake`, {
      method: "POST",
      body: JSON.stringify({
        apiVersion: DIRECTOR_HOST_API_VERSION,
        snapshot: benchmarkCase.clarifySnapshot,
        intake: clarifyIntake,
      }),
    });
    if (!intakeResult.response.ok) {
      failures.push(`/v1/intake failed (${intakeResult.response.status}).`);
    } else {
      failures.push(
        ...compareSubset(intakeResult.body, {
          clarification: {
            decision: benchmarkCase.expectedClarify.decision,
          },
          alignmentState: benchmarkCase.expectedClarify.alignmentState,
        }),
      );
      const questionIds = (intakeResult.body?.clarification?.questions ?? []).map(
        (question) => question.questionId,
      );
      for (const code of benchmarkCase.expectedClarify.missingQuestionCodes ?? []) {
        if (!questionIds.includes(code)) {
          failures.push(`Intake clarification missing expected question code ${code}.`);
        }
      }
      apiChecks.intakeDecision = intakeResult.body?.clarification?.decision ?? null;
    }

    const clarifyResult = await requestJson(`${hostApi.baseUrl}/v1/clarify`, {
      method: "POST",
      body: JSON.stringify({
        apiVersion: DIRECTOR_HOST_API_VERSION,
        snapshot: benchmarkCase.clarifySnapshot,
        intake: clarifyIntake,
        answers: [],
      }),
    });
    if (!clarifyResult.response.ok) {
      failures.push(`/v1/clarify failed (${clarifyResult.response.status}).`);
    } else {
      failures.push(
        ...compareSubset(clarifyResult.body, {
          clarification: {
            decision: benchmarkCase.expectedClarify.decision,
          },
        }),
      );
      apiChecks.clarifyDecision = clarifyResult.body?.clarification?.decision ?? null;
    }

    const readyIntake = buildIntake(benchmarkCase.readySnapshot);
    const blueprintResult = await requestJson(`${hostApi.baseUrl}/v1/blueprint`, {
      method: "POST",
      body: JSON.stringify({
        apiVersion: DIRECTOR_HOST_API_VERSION,
        snapshot: benchmarkCase.readySnapshot,
        intake: readyIntake,
        alignmentLock: buildAlignmentLock(benchmarkCase.readySnapshot, readyIntake),
      }),
    });
    if (!blueprintResult.response.ok) {
      failures.push(`/v1/blueprint failed (${blueprintResult.response.status}).`);
    } else {
      failures.push(
        ...compareSubset(blueprintResult.body, {
          review: {
            overallDecision: benchmarkCase.expectedBlueprint.review,
          },
        }),
      );

      const nodeRoles = blueprintResult.body?.actionGraph?.nodes?.map((node) => node.role) ?? [];
      for (const role of benchmarkCase.expectedBlueprint.requiredRoles ?? []) {
        if (!nodeRoles.includes(role)) {
          failures.push(`Blueprint action graph missing required role ${role}.`);
        }
      }

      const upstreamRole = benchmarkCase.expectedBlueprint.parallelDependency?.upstreamRole;
      const downstreamRoles =
        benchmarkCase.expectedBlueprint.parallelDependency?.downstreamRoles ?? [];
      const upstreamNode =
        upstreamRole === undefined
          ? null
          : extractRoleNode(blueprintResult.body?.actionGraph?.nodes ?? [], upstreamRole);
      if (upstreamRole !== undefined && upstreamNode === null) {
        failures.push(`Missing upstream role ${upstreamRole} for parallel dependency check.`);
      }
      for (const role of downstreamRoles) {
        const node = extractRoleNode(blueprintResult.body?.actionGraph?.nodes ?? [], role);
        if (!node) {
          failures.push(`Missing downstream role ${role} for parallel dependency check.`);
          continue;
        }
        if (
          upstreamNode !== null &&
          (!Array.isArray(node.dependsOn) || !node.dependsOn.includes(upstreamNode.assignmentId))
        ) {
          failures.push(`${role} should depend on ${upstreamRole}.`);
        }
      }

      const routerNode = extractRoleNode(
        blueprintResult.body?.actionGraph?.nodes ?? [],
        benchmarkCase.expectedBlueprint.requiresEscalationRole,
      );
      if (!routerNode) {
        failures.push(
          `Missing escalation role ${benchmarkCase.expectedBlueprint.requiresEscalationRole} in blueprint.`,
        );
      } else {
        if (routerNode.escalationToDirector !== true) {
          failures.push(`${routerNode.role} should escalate back to the director in Beta-1.`);
        }
        if (
          typeof routerNode.fallbackPolicy !== "string" ||
          !routerNode.fallbackPolicy.includes(
            benchmarkCase.expectedBlueprint.routerFallbackIncludes,
          )
        ) {
          failures.push(
            `${routerNode.role} fallback policy did not include the required guardrail.`,
          );
        }
      }

      apiChecks.blueprintId = blueprintResult.body?.blueprintId ?? null;
    }

    cliRuns.runtime = runHotflowCli(
      repoRoot,
      ["director", "runtime", "--host", hostApi.baseUrl],
      cliEnv,
    );
    failures.push(
      ...verifyCliRun(cliRuns.runtime, "director runtime", "Director runtime snapshot:"),
    );

    cliRuns.intake = runHotflowCli(
      repoRoot,
      ["director", "intake", "--input", clarifySnapshotPath, "--host", hostApi.baseUrl],
      cliEnv,
    );
    failures.push(...verifyCliRun(cliRuns.intake, "director intake", "Director intake result:"));

    cliRuns.clarify = runHotflowCli(
      repoRoot,
      ["director", "clarify", "--input", clarifySnapshotPath, "--host", hostApi.baseUrl],
      cliEnv,
    );
    failures.push(...verifyCliRun(cliRuns.clarify, "director clarify", "Director clarify result:"));

    cliRuns.evaluate = runHotflowCli(
      repoRoot,
      ["director", "evaluate", "--input", clarifySnapshotPath, "--host", hostApi.baseUrl],
      cliEnv,
    );
    failures.push(
      ...verifyCliRun(cliRuns.evaluate, "director evaluate", "Director evaluation result:"),
    );

    cliRuns.blueprint = runHotflowCli(
      repoRoot,
      ["director", "blueprint", "--input", readySnapshotPath, "--host", hostApi.baseUrl],
      cliEnv,
    );
    failures.push(
      ...verifyCliRun(cliRuns.blueprint, "director blueprint", "Director blueprint result:"),
    );

    writeFileSync(
      outcomePath,
      JSON.stringify(
        {
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshotId: benchmarkCase.readySnapshot.snapshotId,
          blueprintId: blueprintResult.body?.blueprintId,
          handoffId: blueprintResult.body?.handoff?.handoffId,
          outcome: {
            outcomeId: `outcome-${benchmarkCase.readySnapshot.snapshotId}`,
            status: "accepted",
            recordedAt: new Date().toISOString(),
            notes: "benchmark operator approved preview",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    cliRuns.outcome = runHotflowCli(
      repoRoot,
      ["director", "outcome", "--input", outcomePath, "--host", hostApi.baseUrl],
      cliEnv,
    );
    failures.push(
      ...verifyCliRun(cliRuns.outcome, "director outcome", "Director outcome recorded:"),
    );

    const observations = await waitForObservationFile(
      observationPath,
      expectedObservationCount,
      8000,
    );
    const observationSources = [...new Set(observations.map((entry) => entry.source))].sort();
    for (const source of benchmarkCase.expectedObservationSources ?? []) {
      if (!observationSources.includes(source)) {
        failures.push(`Observation log missing source ${source}.`);
      }
    }
    const acceptedOutcome = observations.find(
      (entry) => entry.source === "outcome" && entry.outcome?.status === "accepted",
    );
    if (!acceptedOutcome) {
      failures.push("Observation log missing accepted outcome evidence.");
    }

    cliRuns.status = runHotflowCli(repoRoot, ["director", "status"], cliEnv);
    failures.push(...verifyCliRun(cliRuns.status, "director status", "Director status:"));
    const observationRecordCount = parseStatusObservationCount(cliRuns.status.stdout);
    if (observationRecordCount === null) {
      failures.push("director status should expose observation records.");
    } else if (observationRecordCount < expectedObservationCount) {
      failures.push(
        `director status should report at least ${expectedObservationCount} observation records, received ${observationRecordCount}.`,
      );
    }

    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    return {
      id: benchmarkCase.id,
      success: failures.length === 0,
      durationMs: Number(durationMs.toFixed(2)),
      failures,
      apiChecks,
      cli: Object.fromEntries(
        Object.entries(cliRuns).map(([key, run]) => [
          key,
          {
            status: run.status,
            durationMs: run.durationMs,
            stdoutPreview: preview(run.stdout),
            stderrPreview: preview(run.stderr),
          },
        ]),
      ),
      hostApi:
        hostApi === null
          ? null
          : {
              host: hostApi.host,
              port: hostApi.port,
              stdoutPreview: preview(hostApi.getLogs().stdout),
              stderrPreview: preview(hostApi.getLogs().stderr),
            },
      observation: {
        path: observationPath,
        recordCount: observations.length,
        sources: observationSources,
      },
    };
  } finally {
    await hostApi?.close().catch(() => undefined);
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

if (!Array.isArray(fixture.cases) || fixture.cases.length === 0) {
  fail("No Director Beta-1 golden path cases found in fixture.");
}

mkdirSync(resultsDir, { recursive: true });

const runs = [];
for (const benchmarkCase of fixture.cases) {
  runs.push(await runCase(benchmarkCase));
}

const failed = runs.filter((run) => !run.success);
const report = {
  suiteId: fixture.suiteId ?? "director-beta1-golden-path-gate",
  generatedAt: new Date().toISOString(),
  summary: {
    total: runs.length,
    failed: failed.length,
    passed: runs.length - failed.length,
    totalDurationMs: Number(runs.reduce((sum, run) => sum + run.durationMs, 0).toFixed(2)),
  },
  runs,
};

const reportPath = resolve(resultsDir, "director-beta1-golden-path-gate-latest.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));

process.stdout.write(
  `Director Beta-1 golden path gate completed: ${runs.length} runs, failed ${failed.length}\n`,
);
process.stdout.write(`Report: ${reportPath}\n`);

if (failed.length > 0) {
  fail(
    "Director Beta-1 golden path gate failed.",
    failed.map((run) => `${run.id}: ${run.failures.join(" | ")}`).join("\n"),
  );
}
