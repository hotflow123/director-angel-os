import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  getBenchmarksPaths,
  runHotflowCliCommand,
  runHotflowCliWithBuiltWorker,
  runWorkspaceBuild,
} from "./cli-command.mjs";

const DIRECTOR_HOST_API_VERSION = "director-host-api.v1";
const pnpmBin = process.env.npm_execpath ?? (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const { benchmarksDir, repoRoot, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(
  benchmarksDir,
  "fixtures",
  "director-phase-p2-wave4-non-retryable-bridge-failure-gate.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

function fail(message, details) {
  if (details) {
    process.stderr.write(`${message}\n${details}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

function preview(output, lines = 25) {
  return String(output ?? "")
    .split("\n")
    .slice(0, lines)
    .join("\n");
}

function runBuild(target) {
  const result = runWorkspaceBuild(target);

  if (result.status !== 0) {
    fail(
      `Failed to build ${target} before Director Phase P2 Wave 4 gate.`,
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
    );
  }
}

function runHotflowCli(command, env) {
  return runHotflowCliCommand(command, env);
}

function recordCommandRun(commandRuns, action, command, result) {
  commandRuns.push({
    action,
    command,
    status: result.status,
    durationMs: result.durationMs,
    stdoutPreview: preview(result.stdout),
    stderrPreview: preview(result.stderr),
  });
}

function approveRunAssignment({
  commandRuns,
  cliEnv,
  failures,
  hostBaseUrl,
  runId,
  assignmentId,
  action,
}) {
  const command = [
    "director",
    "run",
    "approve",
    "--run-id",
    runId,
    "--assignment-id",
    assignmentId,
    "--host",
    hostBaseUrl,
  ];
  const approveRun = runHotflowCli(command, cliEnv);
  recordCommandRun(commandRuns, action, command, approveRun);
  if (approveRun.status !== 0) {
    failures.push(`director run approve ${assignmentId} exited with ${approveRun.status}.`);
  }
}

function verifyNeedles(output, label, needles, failures) {
  for (const needle of needles ?? []) {
    if (!output.includes(needle)) {
      failures.push(`${label} should include "${needle}".`);
    }
  }
}

function assertNotContains(output, label, needles, failures) {
  for (const needle of needles ?? []) {
    if (output.includes(needle)) {
      failures.push(`${label} should not include "${needle}".`);
    }
  }
}

function assertNoSecretLeak(output, secrets, label, failures) {
  for (const secret of secrets) {
    if (output.includes(secret)) {
      failures.push(`${label} should not leak ${secret}.`);
    }
  }
}

function buildExecutionIntake(snapshot) {
  const objective =
    snapshot.project.outline ??
    snapshot.project.title ??
    `Phase P2 Wave 4 execution request for ${snapshot.group.groupId}`;

  return {
    intakeId: `intake-${snapshot.snapshotId}`,
    submittedAt: snapshot.createdAt,
    objective,
    desiredOutcome: objective,
    deliverables: [
      "Submit bounded script and shot execution requests with a retry policy boundary.",
    ],
    notes: ["Benchmark synthesized intake payload for Director Angel Phase P2 Wave 4."],
  };
}

function buildAlignmentLock(snapshot, intake) {
  return {
    lockId: `alignment-lock-${snapshot.snapshotId}`,
    sourceIntakeId: intake.intakeId,
    state: "locked",
    lockedAt: snapshot.createdAt,
    objective: intake.objective,
    desiredOutcome: intake.desiredOutcome,
    deliverables: intake.deliverables ?? [],
    lockedConstraints: [],
    lockedFields: [],
  };
}

function findNodeByRole(nodes, role) {
  return nodes?.find((node) => node.role === role) ?? null;
}

function findAssignmentByRole(assignments, role) {
  return assignments?.find((assignment) => assignment.role === role) ?? null;
}

function normalizeBlueprintForExecutionRun(blueprint, adapterId) {
  const scriptPlanner = findNodeByRole(blueprint?.actionGraph?.nodes, "script-planner");
  const shotPlanner = findNodeByRole(blueprint?.actionGraph?.nodes, "shot-planner");
  if (!scriptPlanner || !shotPlanner) {
    return blueprint;
  }

  return {
    ...blueprint,
    preview: {
      ...(blueprint?.preview ?? {}),
      requiredApprovals: [
        `${scriptPlanner.role}:${scriptPlanner.assignmentId}`,
        `${shotPlanner.role}:${shotPlanner.assignmentId}`,
      ],
    },
    actionGraph: {
      ...blueprint.actionGraph,
      nodes: [
        {
          ...scriptPlanner,
          dependsOn: [],
          status: "awaiting_approval",
          approvalMode: "operator_approve",
          escalationToDirector: false,
          actionClass: scriptPlanner.actionClass ?? "generate",
          selectedAdapter: adapterId,
          allowedAdapters: [adapterId],
        },
        {
          ...shotPlanner,
          dependsOn: [scriptPlanner.assignmentId],
          status: "awaiting_approval",
          approvalMode: "operator_approve",
          escalationToDirector: false,
          actionClass: shotPlanner.actionClass ?? "generate",
          selectedAdapter: adapterId,
          allowedAdapters: [adapterId],
        },
      ],
      edges: [],
      stopConditions: [],
    },
    handoff: {
      ...blueprint.handoff,
      sideEffectsAllowed: true,
      chosenAdapters: [...new Set([...(blueprint?.handoff?.chosenAdapters ?? []), adapterId])],
    },
  };
}

async function requestJson(url, options = {}) {
  let response = null;
  let lastError = null;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      response = await fetch(url, {
        ...options,
        headers: {
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          ...(options.headers ?? {}),
        },
      });
      break;
    } catch (error) {
      lastError = error;
      if (
        attempt === 5 ||
        !(error instanceof TypeError) ||
        !String(error.message).includes("fetch failed")
      ) {
        throw error;
      }
      await delay(attempt * 100);
    }
  }

  if (!response) {
    throw lastError ?? new Error(`Failed to fetch ${url}.`);
  }

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
        server.close(() => rejectPort(new Error("Failed to reserve TCP port.")));
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

async function startDirectorHostApi(env) {
  const host = "127.0.0.1";
  const port = await reservePort(host);
  const baseUrl = `http://${host}:${port}`;
  const stdoutChunks = [];
  const stderrChunks = [];

  const child = spawn(pnpmBin, ["--filter", "@hotflow/director-host-api", "dev"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
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
        // Keep polling until healthy.
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

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function startBridgeServer(sequence, expectedSecret) {
  const requests = [];
  const server = createHttpServer(async (request, response) => {
    const body = await readRequestBody(request);
    const behavior = sequence[requests.length] ?? sequence.at(-1);
    requests.push({
      authorizationMatched: request.headers.authorization === `Bearer ${expectedSecret}`,
      body: body.length === 0 ? null : JSON.parse(body),
      behaviorType: behavior?.type ?? "missing",
    });

    if (behavior?.type === "timeout") {
      await delay(behavior.delayMs ?? 120);
      response.writeHead(behavior.statusCode ?? 202, {
        "content-type": "application/json",
        ...(behavior.requestId === undefined ? {} : { "x-request-id": behavior.requestId }),
      });
      response.end(JSON.stringify({ accepted: behavior.accepted ?? true }));
      return;
    }

    if (behavior?.type === "invalid-json") {
      response.writeHead(behavior.statusCode ?? 202, {
        "content-type": "application/json",
        ...(behavior.requestId === undefined ? {} : { "x-request-id": behavior.requestId }),
      });
      response.end(behavior.body ?? "not-json");
      return;
    }

    const statusCode = behavior?.statusCode ?? 202;
    response.writeHead(statusCode, {
      "content-type": "application/json",
      ...(behavior?.requestId === undefined ? {} : { "x-request-id": behavior.requestId }),
    });
    response.end(
      JSON.stringify({
        ...(behavior?.accepted === undefined ? {} : { accepted: behavior.accepted }),
      }),
    );
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Bridge server did not expose a TCP address.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
    },
  };
}

function writeSwitchDocument(workspaceRoot, overrides) {
  mkdirSync(join(workspaceRoot, ".director-angel", "runtime"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, ".director-angel", "runtime", "switches.json"),
    `${JSON.stringify({ schemaId: "director.switches.v1", ...overrides }, null, 2)}\n`,
    "utf8",
  );
}

async function driveRunUntilStatus({
  desiredStatus,
  hostBaseUrl,
  runId,
  maxAttempts,
  workerEnv,
  commandRuns,
  failures,
  commandPrefix,
}) {
  let latestRun = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const workerRun = await runHotflowCliWithBuiltWorker(
      ["director", "run", "once", "--run-id", runId, "--worker-id", `${commandPrefix}-${attempt}`],
      workerEnv,
    );
    recordCommandRun(
      commandRuns,
      `director-run-once-${commandPrefix}-${attempt}`,
      ["director", "run", "once", "--run-id", runId, "--worker-id", `${commandPrefix}-${attempt}`],
      workerRun,
    );
    if (workerRun.status !== 0) {
      failures.push(
        `director run once ${commandPrefix} attempt ${attempt} exited with ${workerRun.status}.`,
      );
      return null;
    }

    const runResult = await requestJson(`${hostBaseUrl}/v1/runs/${encodeURIComponent(runId)}`);
    if (!runResult.response.ok) {
      failures.push(
        `/v1/runs/:runId returned ${runResult.response.status} during ${commandPrefix}.`,
      );
      return null;
    }

    latestRun = runResult.body;
    if (latestRun?.status === desiredStatus) {
      return latestRun;
    }
    if (
      latestRun?.status === "completed" ||
      latestRun?.status === "failed" ||
      latestRun?.status === "aborted"
    ) {
      break;
    }
  }

  failures.push(`run ${runId} did not reach ${desiredStatus} during ${commandPrefix}.`);
  return latestRun;
}

function expectBridgeFailure(assignment, benchmarkCase, failures) {
  const failure = assignment?.result?.bridgeExecution?.failure;
  if (!failure) {
    failures.push("shot-planner should include bridgeExecution.failure.");
    return;
  }

  if (failure.reason !== benchmarkCase.expected.failureReason) {
    failures.push(
      `shot-planner failure reason expected ${benchmarkCase.expected.failureReason} but received ${failure.reason}.`,
    );
  }
  if (failure.retryable !== benchmarkCase.expected.retryable) {
    failures.push(
      `shot-planner retryable expected ${benchmarkCase.expected.retryable} but received ${failure.retryable}.`,
    );
  }
  if (failure.statusCode !== benchmarkCase.expected.failureStatusCode) {
    failures.push(
      `shot-planner failure status expected ${benchmarkCase.expected.failureStatusCode} but received ${failure.statusCode ?? "(missing)"}.`,
    );
  }
}

function expectOperatorSurfaceForFailure(report, shotPlanner, benchmarkCase, failures) {
  if (!report?.operatorSurface) {
    failures.push("failed run report should include operatorSurface.");
    return;
  }

  if (shotPlanner) {
    if (report.operatorSurface.objective !== shotPlanner.objective) {
      failures.push(
        `failed operator objective expected ${shotPlanner.objective} but received ${report.operatorSurface.objective ?? "(missing)"}.`,
      );
    }
    if (report.operatorSurface.deliverable !== shotPlanner.deliverable) {
      failures.push(
        `failed operator deliverable expected ${shotPlanner.deliverable} but received ${report.operatorSurface.deliverable ?? "(missing)"}.`,
      );
    }
  }
  if (report.operatorSurface.bridgeVerdict !== "failed") {
    failures.push(
      `failed operator bridgeVerdict expected failed but received ${report.operatorSurface.bridgeVerdict ?? "(missing)"}.`,
    );
  }
  if (report.operatorSurface.bridgeFailureReason !== benchmarkCase.expected.failureReason) {
    failures.push(
      `failed operator bridgeFailureReason expected ${benchmarkCase.expected.failureReason} but received ${report.operatorSurface.bridgeFailureReason ?? "(missing)"}.`,
    );
  }
  if (report.operatorSurface.retryable !== benchmarkCase.expected.retryable) {
    failures.push(
      `failed operator retryable expected ${benchmarkCase.expected.retryable} but received ${report.operatorSurface.retryable ?? "(missing)"}.`,
    );
  }
  if (report.operatorSurface.bridgeStatus !== benchmarkCase.expected.failureStatusCode) {
    failures.push(
      `failed operator bridgeStatus expected ${benchmarkCase.expected.failureStatusCode} but received ${report.operatorSurface.bridgeStatus ?? "(missing)"}.`,
    );
  }
  if (report.operatorSurface.nextAction !== benchmarkCase.expected.nextAction) {
    failures.push(
      `failed operator nextAction expected "${benchmarkCase.expected.nextAction}" but received "${report.operatorSurface.nextAction ?? "(missing)"}".`,
    );
  }
}

async function runCase(benchmarkCase) {
  const started = process.hrtime.bigint();
  const workspaceRoot = mkdtempSync(join(tmpdir(), `director-phase-p2-wave4-${benchmarkCase.id}-`));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", `${benchmarkCase.id}.sqlite`);
  const commandRuns = [];
  const failures = [];
  const bridgeSecret = "bench-p2-wave4-secret";
  let bridgeServer = null;
  let hostApi = null;
  let runIdValue = "missing-run-id";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });

  try {
    bridgeServer = await startBridgeServer(benchmarkCase.bridgeBehavior.sequence, bridgeSecret);
    const manifest = structuredClone(fixture.adapterManifest);
    manifest.bridge.baseUrl = bridgeServer.url;

    const manifestPath = join(workspaceRoot, "script-execution-a.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    writeSwitchDocument(workspaceRoot, {
      features: {
        "execution.sideEffects.enabled": true,
      },
    });

    const runtimeEnv = {
      HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      HOTFLOW_DATA_DIR: dataDir,
      HOTFLOW_DEFAULT_PROVIDER: "scripted",
      HOTFLOW_DEFAULT_MODEL: "hotflow-phase1",
      SCRIPT_EXECUTION_API_KEY: bridgeSecret,
    };
    const cliEnv = {
      ...process.env,
      ...runtimeEnv,
      HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
    };
    const hostEnv = {
      ...process.env,
      ...runtimeEnv,
    };
    const workerEnv = {
      ...process.env,
      ...runtimeEnv,
    };

    const registerRun = runHotflowCli(
      ["director", "adapters", "register", "--manifest", manifestPath],
      cliEnv,
    );
    recordCommandRun(
      commandRuns,
      "register",
      ["director", "adapters", "register", "--manifest", manifestPath],
      registerRun,
    );
    if (registerRun.status !== 0) {
      failures.push(`register command exited with ${registerRun.status}.`);
    }
    verifyNeedles(registerRun.stdout, "register stdout", fixture.cliNeedles.register, failures);

    const explainAdapterRun = runHotflowCli(
      ["director", "adapters", "explain", "--adapter-id", benchmarkCase.expected.adapterId],
      cliEnv,
    );
    recordCommandRun(
      commandRuns,
      "adapter-explain",
      ["director", "adapters", "explain", "--adapter-id", benchmarkCase.expected.adapterId],
      explainAdapterRun,
    );
    if (explainAdapterRun.status !== 0) {
      failures.push(`adapter explain command exited with ${explainAdapterRun.status}.`);
    }
    verifyNeedles(
      explainAdapterRun.stdout,
      "adapter explain stdout",
      fixture.cliNeedles.explain,
      failures,
    );
    assertNoSecretLeak(
      explainAdapterRun.stdout,
      ["SCRIPT_EXECUTION_API_KEY", bridgeSecret],
      "adapter explain stdout",
      failures,
    );

    hostApi = await startDirectorHostApi(hostEnv);

    const intake = buildExecutionIntake(benchmarkCase.snapshot);
    const alignmentLock = buildAlignmentLock(benchmarkCase.snapshot, intake);
    const blueprintResult = await requestJson(`${hostApi.baseUrl}/v1/blueprint`, {
      method: "POST",
      body: JSON.stringify({
        apiVersion: DIRECTOR_HOST_API_VERSION,
        snapshot: benchmarkCase.snapshot,
        intake,
        alignmentLock,
      }),
    });
    if (!blueprintResult.response.ok) {
      failures.push(`/v1/blueprint returned ${blueprintResult.response.status}.`);
    }

    const reviewedBlueprint = blueprintResult.body;
    const scriptPlanner = findNodeByRole(reviewedBlueprint?.actionGraph?.nodes, "script-planner");
    const shotPlanner = findNodeByRole(reviewedBlueprint?.actionGraph?.nodes, "shot-planner");
    if (!scriptPlanner || !shotPlanner) {
      failures.push("reviewed blueprint should include script-planner and shot-planner nodes.");
    }
    if (reviewedBlueprint?.review?.overallDecision !== benchmarkCase.expected.reviewDecision) {
      failures.push(
        `reviewed blueprint overallDecision expected ${benchmarkCase.expected.reviewDecision} but received ${reviewedBlueprint?.review?.overallDecision ?? "(missing)"}.`,
      );
    }

    const createRunResult = await requestJson(`${hostApi.baseUrl}/v1/runs`, {
      method: "POST",
      body: JSON.stringify(
        normalizeBlueprintForExecutionRun(reviewedBlueprint, benchmarkCase.expected.adapterId),
      ),
    });
    if (createRunResult.response.status !== 201) {
      failures.push(`/v1/runs returned ${createRunResult.response.status}.`);
    }

    runIdValue = createRunResult.body?.runId ?? "missing-run-id";
    if (!createRunResult.body?.runId) {
      failures.push("run creation response did not include runId.");
    }

    const createdScriptPlanner = findAssignmentByRole(
      createRunResult.body?.assignments,
      "script-planner",
    );
    const createdShotPlanner = findAssignmentByRole(
      createRunResult.body?.assignments,
      "shot-planner",
    );
    approveRunAssignment({
      commandRuns,
      cliEnv,
      failures,
      hostBaseUrl: hostApi.baseUrl,
      runId: runIdValue,
      assignmentId:
        createdScriptPlanner?.assignmentId ?? scriptPlanner?.assignmentId ?? "missing-assignment",
      action: "run-approve-script-planner",
    });
    approveRunAssignment({
      commandRuns,
      cliEnv,
      failures,
      hostBaseUrl: hostApi.baseUrl,
      runId: runIdValue,
      assignmentId:
        createdShotPlanner?.assignmentId ?? shotPlanner?.assignmentId ?? "missing-assignment",
      action: "run-approve-shot-planner",
    });

    const failedRun = await driveRunUntilStatus({
      desiredStatus: "failed",
      hostBaseUrl: hostApi.baseUrl,
      runId: runIdValue,
      maxAttempts: 6,
      workerEnv,
      commandRuns,
      failures,
      commandPrefix: "worker-failure",
    });

    if (bridgeServer.requests.length !== 2) {
      failures.push(
        `bridge server should receive 2 requests before retry handling, got ${bridgeServer.requests.length}.`,
      );
    } else {
      const roles = bridgeServer.requests.map((request) => request.body?.role);
      if (roles.join("|") !== "script-planner|shot-planner") {
        failures.push(
          `bridge role order before retry handling should be script-planner|shot-planner, received ${roles.join("|")}.`,
        );
      }
    }

    const failedShotPlanner = findAssignmentByRole(failedRun?.assignments, "shot-planner");
    expectBridgeFailure(failedShotPlanner, benchmarkCase, failures);

    const failedReportRun = runHotflowCli(
      ["director", "run", "report", "--run-id", runIdValue, "--host", hostApi.baseUrl],
      cliEnv,
    );
    recordCommandRun(
      commandRuns,
      "run-report-failed",
      ["director", "run", "report", "--run-id", runIdValue, "--host", hostApi.baseUrl],
      failedReportRun,
    );
    if (failedReportRun.status !== 0) {
      failures.push(`director run report exited with ${failedReportRun.status} for failed run.`);
    }
    verifyNeedles(
      failedReportRun.stdout,
      "failed run report stdout",
      [
        "Director run report:",
        ...(shotPlanner === null
          ? []
          : [`objective: ${shotPlanner.objective}`, `deliverable: ${shotPlanner.deliverable}`]),
        ...benchmarkCase.expected.failureRunReportNeedles,
      ],
      failures,
    );
    assertNoSecretLeak(
      failedReportRun.stdout,
      ["SCRIPT_EXECUTION_API_KEY", bridgeSecret],
      "failed run report stdout",
      failures,
    );

    const failedReportResult = await requestJson(
      `${hostApi.baseUrl}/v1/runs/${encodeURIComponent(runIdValue)}/report`,
    );
    if (!failedReportResult.response.ok) {
      failures.push(
        `/v1/runs/:runId/report returned ${failedReportResult.response.status} for failed run.`,
      );
    } else {
      expectOperatorSurfaceForFailure(
        failedReportResult.body,
        shotPlanner,
        benchmarkCase,
        failures,
      );
    }

    const failedExplainRun = runHotflowCli(
      ["director", "run", "explain", "--run-id", runIdValue, "--host", hostApi.baseUrl],
      cliEnv,
    );
    recordCommandRun(
      commandRuns,
      "run-explain-failed",
      ["director", "run", "explain", "--run-id", runIdValue, "--host", hostApi.baseUrl],
      failedExplainRun,
    );
    if (failedExplainRun.status !== 0) {
      failures.push(`director run explain exited with ${failedExplainRun.status}.`);
    }
    verifyNeedles(
      failedExplainRun.stdout,
      "failed run explain stdout",
      [
        ...benchmarkCase.expected.failureExplainNeedles,
        ...(failedShotPlanner === null
          ? []
          : [
              benchmarkCase.expected.retryable
                ? `- ${failedShotPlanner.assignmentId} role=shot-planner reason=${benchmarkCase.expected.failureReason} retryable=yes retry-allowed=yes retry-budget=0/1 status=${benchmarkCase.expected.failureStatusCode}`
                : `- ${failedShotPlanner.assignmentId} role=shot-planner reason=${benchmarkCase.expected.failureReason} retryable=no retry-allowed=no status=${benchmarkCase.expected.failureStatusCode}`,
            ]),
      ],
      failures,
    );
    if (benchmarkCase.expected.retryable) {
      verifyNeedles(
        failedExplainRun.stdout,
        "failed run explain stdout",
        [
          `suggested command: hotflow director run retry --run-id ${runIdValue} --assignment-id ${failedShotPlanner?.assignmentId ?? "missing-assignment"}`,
        ],
        failures,
      );
    } else {
      assertNotContains(
        failedExplainRun.stdout,
        "failed run explain stdout",
        ["suggested command: hotflow director run retry"],
        failures,
      );
    }

    if (!benchmarkCase.expected.retryable) {
      const directRetryResult = await requestJson(
        `${hostApi.baseUrl}/v1/runs/${encodeURIComponent(runIdValue)}/retry`,
        {
          method: "POST",
          body: JSON.stringify({
            assignmentId: failedShotPlanner?.assignmentId ?? "missing-assignment",
          }),
        },
      );
      if (directRetryResult.response.status !== 409) {
        failures.push(
          `host retry rejection expected 409 but received ${directRetryResult.response.status}.`,
        );
      }

      const finalRunResult = await requestJson(
        `${hostApi.baseUrl}/v1/runs/${encodeURIComponent(runIdValue)}`,
      );
      if (!finalRunResult.response.ok) {
        failures.push(
          `/v1/runs/:runId returned ${finalRunResult.response.status} after rejected retry.`,
        );
      } else if (finalRunResult.body?.status !== "failed") {
        failures.push(
          `run status after rejected retry expected failed but received ${finalRunResult.body?.status ?? "(missing)"}.`,
        );
      }

      const finalReportResult = await requestJson(
        `${hostApi.baseUrl}/v1/runs/${encodeURIComponent(runIdValue)}/report`,
      );
      if (!finalReportResult.response.ok) {
        failures.push(
          `/v1/runs/:runId/report returned ${finalReportResult.response.status} after rejected retry.`,
        );
      } else {
        expectOperatorSurfaceForFailure(
          finalReportResult.body,
          shotPlanner,
          benchmarkCase,
          failures,
        );
      }
    }

    const retryRun = runHotflowCli(
      [
        "director",
        "run",
        "retry",
        "--run-id",
        runIdValue,
        "--assignment-id",
        failedShotPlanner?.assignmentId ?? "missing-assignment",
        "--host",
        hostApi.baseUrl,
      ],
      cliEnv,
    );
    recordCommandRun(
      commandRuns,
      "run-retry",
      [
        "director",
        "run",
        "retry",
        "--run-id",
        runIdValue,
        "--assignment-id",
        failedShotPlanner?.assignmentId ?? "missing-assignment",
        "--host",
        hostApi.baseUrl,
      ],
      retryRun,
    );

    if (benchmarkCase.expected.retryable) {
      if (retryRun.status !== 0) {
        failures.push(`director run retry exited with ${retryRun.status}.`);
      }
      verifyNeedles(
        retryRun.stdout,
        "run retry stdout",
        ["Director run:", ...benchmarkCase.expected.retryRunNeedles],
        failures,
      );

      const completedRun = await driveRunUntilStatus({
        desiredStatus: "completed",
        hostBaseUrl: hostApi.baseUrl,
        runId: runIdValue,
        maxAttempts: 6,
        workerEnv,
        commandRuns,
        failures,
        commandPrefix: "worker-retry",
      });

      if (bridgeServer.requests.length !== 3) {
        failures.push(
          `bridge server should receive 3 requests after retry, got ${bridgeServer.requests.length}.`,
        );
      }

      const completedShotPlanner = findAssignmentByRole(completedRun?.assignments, "shot-planner");
      if (
        completedShotPlanner?.result?.bridgeExecution?.response?.requestId !==
        benchmarkCase.expected.retryRequestId
      ) {
        failures.push(
          `completed shot-planner requestId expected ${benchmarkCase.expected.retryRequestId} but received ${completedShotPlanner?.result?.bridgeExecution?.response?.requestId ?? "(missing)"}.`,
        );
      }

      const finalReportRun = runHotflowCli(
        ["director", "run", "report", "--run-id", runIdValue, "--host", hostApi.baseUrl],
        cliEnv,
      );
      recordCommandRun(
        commandRuns,
        "run-report-final",
        ["director", "run", "report", "--run-id", runIdValue, "--host", hostApi.baseUrl],
        finalReportRun,
      );
      if (finalReportRun.status !== 0) {
        failures.push(`director final run report exited with ${finalReportRun.status}.`);
      }
      verifyNeedles(
        finalReportRun.stdout,
        "final run report stdout",
        ["Director run report:", ...benchmarkCase.expected.finalRunReportNeedles],
        failures,
      );

      if (completedRun?.status !== "completed") {
        failures.push(
          `final run status expected completed but received ${completedRun?.status ?? "(missing)"}.`,
        );
      }

      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      return {
        id: benchmarkCase.id,
        status: failures.length === 0 ? "passed" : "failed",
        durationMs: Number(durationMs.toFixed(2)),
        failures,
        evidence: {
          runId: runIdValue,
          bridgeRequests: bridgeServer.requests.map((request) => ({
            role: request.body?.role,
            assignmentId: request.body?.assignmentId,
            behaviorType: request.behaviorType,
          })),
        },
        commandRuns,
      };
    }

    if (retryRun.status === 0) {
      failures.push("director run retry should fail for a non-retryable bridge failure.");
    }
    verifyNeedles(
      retryRun.stdout,
      "run retry stdout",
      benchmarkCase.expected.retryFailureNeedles,
      failures,
    );
    if (bridgeServer.requests.length !== 2) {
      failures.push(
        `bridge server should stay at 2 requests after rejected retry, got ${bridgeServer.requests.length}.`,
      );
    }

    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    return {
      id: benchmarkCase.id,
      status: failures.length === 0 ? "passed" : "failed",
      durationMs: Number(durationMs.toFixed(2)),
      failures,
      evidence: {
        runId: runIdValue,
        bridgeRequests: bridgeServer.requests.map((request) => ({
          role: request.body?.role,
          assignmentId: request.body?.assignmentId,
          behaviorType: request.behaviorType,
        })),
      },
      commandRuns,
    };
  } catch (error) {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    return {
      id: benchmarkCase.id,
      status: "failed",
      durationMs: Number(durationMs.toFixed(2)),
      failures: [
        ...failures,
        error instanceof Error ? (error.stack ?? error.message) : String(error),
        ...(hostApi ? [preview(hostApi.getLogs().stderr)] : []),
      ],
      evidence: {
        runId: runIdValue,
      },
      commandRuns,
    };
  } finally {
    if (hostApi) {
      await hostApi.close();
    }
    if (bridgeServer) {
      await bridgeServer.close();
    }
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

async function main() {
  for (const target of [
    "@hotflow/director-host-contracts",
    "@hotflow/director-execution-contracts",
    "@hotflow/director-runtime",
    "@hotflow/director-execution",
    "@hotflow/director-memory-contracts",
    "@hotflow/director-memory",
    "@hotflow/director-workspace",
    "@hotflow/director-worker",
  ]) {
    runBuild(target);
  }

  mkdirSync(resultsDir, { recursive: true });
  const caseResults = [];
  for (const benchmarkCase of fixture.cases ?? []) {
    caseResults.push(await runCase(benchmarkCase));
  }

  const failed = caseResults.filter((result) => result.status !== "passed");
  const report = {
    suiteId: fixture.suiteId,
    fixturePath,
    generatedAt: new Date().toISOString(),
    summary: {
      total: caseResults.length,
      failed: failed.length,
      passed: caseResults.length - failed.length,
      totalDurationMs: Number(
        caseResults.reduce((sum, result) => sum + result.durationMs, 0).toFixed(2),
      ),
    },
    caseResults,
  };

  const latestPath = resolve(
    resultsDir,
    "director-phase-p2-wave4-non-retryable-bridge-failure-gate-latest.json",
  );
  writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  process.stdout.write(
    `Director Phase P2 Wave 4 non-retryable bridge failure gate completed: ${caseResults.length} runs, failed ${failed.length}\n`,
  );
  process.stdout.write(`Report: ${latestPath}\n`);

  if (failed.length > 0) {
    fail(
      "Director Phase P2 Wave 4 non-retryable bridge failure gate failed.",
      failed.map((result) => `${result.id}: ${result.failures.join(" | ")}`).join("\n"),
    );
  }
}

await main();
