import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  "director-phase-p2-wave1-real-execution-adapter-handoff-gate.json",
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
      `Failed to build ${target} before Director Phase P2 Wave 1 gate.`,
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

function verifyNeedles(output, label, needles, failures) {
  for (const needle of needles ?? []) {
    if (!output.includes(needle)) {
      failures.push(`${label} should include "${needle}".`);
    }
  }
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

function assertNoSecretLeak(output, secrets, label, failures) {
  for (const secret of secrets) {
    if (output.includes(secret)) {
      failures.push(`${label} should not leak ${secret}.`);
    }
  }
}

function assertFileExists(path, label, failures) {
  if (!existsSync(path)) {
    failures.push(`Missing ${label}: ${path}`);
  }
}

function isTerminalRunStatus(status) {
  return status === "completed" || status === "failed" || status === "aborted";
}

function buildExecutionIntake(snapshot) {
  const objective =
    snapshot.project.outline ??
    snapshot.project.title ??
    `Phase P2 Wave 1 execution request for ${snapshot.group.groupId}`;

  return {
    intakeId: `intake-${snapshot.snapshotId}`,
    submittedAt: snapshot.createdAt,
    objective,
    desiredOutcome: objective,
    deliverables: ["Submit one bounded execution adapter request."],
    notes: ["Benchmark synthesized intake payload for Director Angel Phase P2 Wave 1."],
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

function normalizeBlueprintForExecutionRun(blueprint, adapterId, runOverrides = {}) {
  const scriptPlanner =
    blueprint?.actionGraph?.nodes?.find((node) => node.role === "script-planner") ?? null;
  if (!scriptPlanner) {
    return blueprint;
  }

  return {
    ...blueprint,
    preview: {
      ...(blueprint?.preview ?? {}),
      requiredApprovals: [`${scriptPlanner.role}:${scriptPlanner.assignmentId}`],
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
      ],
      edges: [],
      stopConditions: [],
    },
    handoff: {
      ...blueprint.handoff,
      sideEffectsAllowed:
        runOverrides.sideEffectsAllowed ?? blueprint?.handoff?.sideEffectsAllowed ?? false,
      chosenAdapters: [...new Set([...(blueprint?.handoff?.chosenAdapters ?? []), adapterId])],
    },
  };
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

async function startBridgeServer(behavior, expectedSecret) {
  const requests = [];
  const server = createHttpServer(async (request, response) => {
    const body = await readRequestBody(request);
    requests.push({
      authorizationMatched: request.headers.authorization === `Bearer ${expectedSecret}`,
      body: body.length === 0 ? null : JSON.parse(body),
    });

    response.writeHead(behavior.statusCode ?? 202, {
      "content-type": "application/json",
      ...(behavior.requestId === undefined ? {} : { "x-request-id": behavior.requestId }),
    });
    response.end(
      JSON.stringify({
        ...(behavior.accepted === undefined ? {} : { accepted: behavior.accepted }),
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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function runCase(benchmarkCase) {
  const started = process.hrtime.bigint();
  const workspaceRoot = mkdtempSync(join(tmpdir(), `director-phase-p2-wave1-${benchmarkCase.id}-`));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", `${benchmarkCase.id}.sqlite`);
  const commandRuns = [];
  const failures = [];
  const bridgeSecret = "bench-p2-wave1-secret";
  let bridgeServer = null;
  let hostApi = null;
  let runIdValue = "missing-run-id";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });

  try {
    bridgeServer = await startBridgeServer(benchmarkCase.bridgeBehavior, bridgeSecret);
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

    const explainRun = runHotflowCli(
      ["director", "adapters", "explain", "--adapter-id", benchmarkCase.expected.adapterId],
      cliEnv,
    );
    recordCommandRun(
      commandRuns,
      "explain",
      ["director", "adapters", "explain", "--adapter-id", benchmarkCase.expected.adapterId],
      explainRun,
    );
    if (explainRun.status !== 0) {
      failures.push(`explain command exited with ${explainRun.status}.`);
    }
    verifyNeedles(explainRun.stdout, "explain stdout", fixture.cliNeedles.explain, failures);
    assertNoSecretLeak(
      explainRun.stdout,
      ["SCRIPT_EXECUTION_API_KEY", bridgeSecret],
      "explain stdout",
      failures,
    );

    hostApi = await startDirectorHostApi(hostEnv);

    const runtimeSnapshot = await requestJson(`${hostApi.baseUrl}/v1/runtime/snapshot`);
    if (!runtimeSnapshot.response.ok) {
      failures.push(`/v1/runtime/snapshot returned ${runtimeSnapshot.response.status}.`);
    } else {
      const adapter =
        runtimeSnapshot.body?.capabilitySnapshot?.adapters?.find(
          (entry) => entry.adapterId === benchmarkCase.expected.adapterId,
        ) ?? null;
      if (!adapter) {
        failures.push("runtime snapshot did not include the persisted execution adapter.");
      } else {
        if (adapter.bridge?.kind !== "http-json") {
          failures.push(
            `runtime snapshot bridge kind expected http-json but received ${adapter.bridge?.kind ?? "(missing)"}.`,
          );
        }
        if (adapter.bridge?.authMode !== "env") {
          failures.push(
            `runtime snapshot bridge authMode expected env but received ${adapter.bridge?.authMode ?? "(missing)"}.`,
          );
        }
        if (adapter.bridge?.endpointPath !== manifest.bridge.submitPath) {
          failures.push(
            `runtime snapshot bridge path expected ${manifest.bridge.submitPath} but received ${adapter.bridge?.endpointPath ?? "(missing)"}.`,
          );
        }
        if (adapter.bridge?.headerKeys?.includes("x-bridge-id") !== true) {
          failures.push("runtime snapshot bridge headerKeys should include x-bridge-id.");
        }
      }
    }
    assertNoSecretLeak(
      JSON.stringify(runtimeSnapshot.body ?? {}),
      ["SCRIPT_EXECUTION_API_KEY", bridgeSecret],
      "runtime snapshot",
      failures,
    );

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
    const scriptPlanner =
      reviewedBlueprint?.actionGraph?.nodes?.find((node) => node.role === "script-planner") ?? null;
    if (!scriptPlanner) {
      failures.push("reviewed blueprint did not include a script-planner node.");
    } else {
      if (scriptPlanner.selectedAdapter !== benchmarkCase.expected.adapterId) {
        failures.push(
          `script-planner selectedAdapter expected ${benchmarkCase.expected.adapterId} but received ${scriptPlanner.selectedAdapter ?? "(missing)"}.`,
        );
      }
      if (!scriptPlanner.allowedAdapters?.includes(benchmarkCase.expected.adapterId)) {
        failures.push(
          `script-planner allowedAdapters should include ${benchmarkCase.expected.adapterId}.`,
        );
      }
      if (scriptPlanner.actionClass !== "generate") {
        failures.push(
          `script-planner actionClass expected generate but received ${scriptPlanner.actionClass ?? "(missing)"}.`,
        );
      }
    }
    if (reviewedBlueprint?.review?.overallDecision !== benchmarkCase.expected.reviewDecision) {
      failures.push(
        `reviewed blueprint overallDecision expected ${benchmarkCase.expected.reviewDecision} but received ${reviewedBlueprint?.review?.overallDecision ?? "(missing)"}.`,
      );
    }
    if (reviewedBlueprint?.handoff?.sideEffectsAllowed !== true) {
      failures.push(
        "reviewed blueprint should allow side effects for the selected execution adapter.",
      );
    }
    if (!reviewedBlueprint?.handoff?.chosenAdapters?.includes(benchmarkCase.expected.adapterId)) {
      failures.push(
        `reviewed blueprint handoff should include chosen adapter ${benchmarkCase.expected.adapterId}.`,
      );
    }

    const executableBlueprint = normalizeBlueprintForExecutionRun(
      reviewedBlueprint,
      benchmarkCase.expected.adapterId,
      benchmarkCase.runOverrides ?? {},
    );
    const createRunResult = await requestJson(`${hostApi.baseUrl}/v1/runs`, {
      method: "POST",
      body: JSON.stringify(executableBlueprint),
    });
    if (createRunResult.response.status !== 201) {
      failures.push(`/v1/runs returned ${createRunResult.response.status}.`);
    }

    const createdRun = createRunResult.body;
    runIdValue = createdRun?.runId ?? "missing-run-id";
    if (!createdRun?.runId) {
      failures.push("run creation response did not include runId.");
    }
    if (createdRun?.sideEffectsAllowed !== benchmarkCase.expected.runSideEffectsAllowed) {
      failures.push(
        `created run sideEffectsAllowed expected ${benchmarkCase.expected.runSideEffectsAllowed} but received ${createdRun?.sideEffectsAllowed ?? "(missing)"}.`,
      );
    }
    const createdScriptPlanner =
      createdRun?.assignments?.find((assignment) => assignment.role === "script-planner") ?? null;
    if (createdScriptPlanner?.selectedAdapter !== benchmarkCase.expected.adapterId) {
      failures.push(
        `created run script-planner selectedAdapter expected ${benchmarkCase.expected.adapterId} but received ${createdScriptPlanner?.selectedAdapter ?? "(missing)"}.`,
      );
    }

    const approveRun = runHotflowCli(
      [
        "director",
        "run",
        "approve",
        "--run-id",
        runIdValue,
        "--assignment-id",
        createdScriptPlanner?.assignmentId ?? scriptPlanner?.assignmentId ?? "missing-assignment",
        "--host",
        hostApi.baseUrl,
      ],
      cliEnv,
    );
    recordCommandRun(
      commandRuns,
      "run-approve-script-planner",
      [
        "director",
        "run",
        "approve",
        "--run-id",
        runIdValue,
        "--assignment-id",
        createdScriptPlanner?.assignmentId ?? scriptPlanner?.assignmentId ?? "missing-assignment",
        "--host",
        hostApi.baseUrl,
      ],
      approveRun,
    );
    if (approveRun.status !== 0) {
      failures.push(`director run approve exited with ${approveRun.status}.`);
    }

    let lastWorkerPayload = null;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const workerRun = await runHotflowCliWithBuiltWorker(
        [
          "director",
          "run",
          "once",
          "--run-id",
          runIdValue,
          "--worker-id",
          `${benchmarkCase.id}-${attempt}`,
        ],
        workerEnv,
      );
      recordCommandRun(
        commandRuns,
        `director-run-once-${attempt}`,
        [
          "director",
          "run",
          "once",
          "--run-id",
          runIdValue,
          "--worker-id",
          `${benchmarkCase.id}-${attempt}`,
        ],
        workerRun,
      );
      if (workerRun.status !== 0) {
        failures.push(`director run once attempt ${attempt} exited with ${workerRun.status}.`);
        break;
      }

      lastWorkerPayload = coerceJson(workerRun.stdout);
      if (!lastWorkerPayload) {
        failures.push(`director run once attempt ${attempt} did not emit valid JSON.`);
        break;
      }

      if (isTerminalRunStatus(lastWorkerPayload.status)) {
        break;
      }
    }

    if (!lastWorkerPayload || !isTerminalRunStatus(lastWorkerPayload.status)) {
      failures.push(
        "director run once did not drive the run to a terminal status within 6 passes.",
      );
    } else if (lastWorkerPayload.status !== benchmarkCase.expected.runStatus) {
      failures.push(
        `worker terminal status expected ${benchmarkCase.expected.runStatus} but received ${lastWorkerPayload.status}.`,
      );
    }

    if (bridgeServer.requests.length !== benchmarkCase.expected.bridgeRequestCount) {
      failures.push(
        `bridge server expected ${benchmarkCase.expected.bridgeRequestCount} request(s) but received ${bridgeServer.requests.length}.`,
      );
    }
    if (benchmarkCase.expected.bridgeRequestCount > 0) {
      const bridgeRequest = bridgeServer.requests[0];
      if (!bridgeRequest?.authorizationMatched) {
        failures.push("bridge server did not receive the expected bearer credential.");
      }
      if (bridgeRequest?.body?.schemaId !== "director.execution.http-json-request.v1") {
        failures.push(
          `bridge request schemaId expected director.execution.http-json-request.v1 but received ${bridgeRequest?.body?.schemaId ?? "(missing)"}.`,
        );
      }
      if (bridgeRequest?.body?.adapterId !== benchmarkCase.expected.adapterId) {
        failures.push(
          `bridge request adapterId expected ${benchmarkCase.expected.adapterId} but received ${bridgeRequest?.body?.adapterId ?? "(missing)"}.`,
        );
      }
      if (bridgeRequest?.body?.role !== "script-planner") {
        failures.push(
          `bridge request role expected script-planner but received ${bridgeRequest?.body?.role ?? "(missing)"}.`,
        );
      }
      if (bridgeRequest?.body?.actionClass !== "generate") {
        failures.push(
          `bridge request actionClass expected generate but received ${bridgeRequest?.body?.actionClass ?? "(missing)"}.`,
        );
      }
      if (scriptPlanner && bridgeRequest?.body?.assignmentId !== scriptPlanner.assignmentId) {
        failures.push(
          `bridge request assignmentId expected ${scriptPlanner.assignmentId} but received ${bridgeRequest?.body?.assignmentId ?? "(missing)"}.`,
        );
      }
    }

    const runResult = await requestJson(
      `${hostApi.baseUrl}/v1/runs/${encodeURIComponent(runIdValue)}`,
    );
    if (!runResult.response.ok) {
      failures.push(`/v1/runs/:runId returned ${runResult.response.status}.`);
    } else {
      if (runResult.body?.status !== benchmarkCase.expected.runStatus) {
        failures.push(
          `run status expected ${benchmarkCase.expected.runStatus} but received ${runResult.body?.status ?? "(missing)"}.`,
        );
      }
      if (runResult.body?.sideEffectsAllowed !== benchmarkCase.expected.runSideEffectsAllowed) {
        failures.push(
          `final run sideEffectsAllowed expected ${benchmarkCase.expected.runSideEffectsAllowed} but received ${runResult.body?.sideEffectsAllowed ?? "(missing)"}.`,
        );
      }
      const finalScriptPlanner =
        runResult.body?.assignments?.find((assignment) => assignment.role === "script-planner") ??
        null;
      if (benchmarkCase.expected.bridgeRequestCount > 0) {
        if (!finalScriptPlanner?.result?.bridgeExecution) {
          failures.push(
            "final run should include bridgeExecution on the script-planner assignment.",
          );
        } else {
          if (
            finalScriptPlanner.result.bridgeExecution.response?.statusCode !==
            benchmarkCase.bridgeBehavior.statusCode
          ) {
            failures.push(
              `bridgeExecution.response.statusCode expected ${benchmarkCase.bridgeBehavior.statusCode} but received ${finalScriptPlanner.result.bridgeExecution.response?.statusCode ?? "(missing)"}.`,
            );
          }
          if (
            finalScriptPlanner.result.bridgeExecution.response?.requestId !==
            benchmarkCase.bridgeBehavior.requestId
          ) {
            failures.push(
              `bridgeExecution.response.requestId expected ${benchmarkCase.bridgeBehavior.requestId} but received ${finalScriptPlanner.result.bridgeExecution.response?.requestId ?? "(missing)"}.`,
            );
          }
        }
      } else if (finalScriptPlanner?.result?.bridgeExecution !== undefined) {
        failures.push("preview fallback run should not persist a bridgeExecution payload.");
      }
    }

    const reportRun = runHotflowCli(
      ["director", "run", "report", "--run-id", runIdValue, "--host", hostApi.baseUrl],
      cliEnv,
    );
    recordCommandRun(
      commandRuns,
      "run-report",
      ["director", "run", "report", "--run-id", runIdValue, "--host", hostApi.baseUrl],
      reportRun,
    );
    if (reportRun.status !== 0) {
      failures.push(`director run report exited with ${reportRun.status}.`);
    }
    verifyNeedles(
      reportRun.stdout,
      "run report stdout",
      ["Director run report:", ...benchmarkCase.expected.runReportNeedles],
      failures,
    );
    assertNoSecretLeak(
      reportRun.stdout,
      ["SCRIPT_EXECUTION_API_KEY", bridgeSecret],
      "run report stdout",
      failures,
    );

    const reportResult = await requestJson(
      `${hostApi.baseUrl}/v1/runs/${encodeURIComponent(runIdValue)}/report`,
    );
    if (!reportResult.response.ok) {
      failures.push(`/v1/runs/:runId/report returned ${reportResult.response.status}.`);
    } else {
      for (const flag of benchmarkCase.expected.reportFlags ?? []) {
        if (!reportResult.body?.flags?.includes(flag)) {
          failures.push(`run report flags should include ${flag}.`);
        }
      }
      for (const flag of benchmarkCase.expected.forbiddenReportFlags ?? []) {
        if (reportResult.body?.flags?.includes(flag)) {
          failures.push(`run report flags should not include ${flag}.`);
        }
      }
      if (benchmarkCase.expected.bridgeMetricsAbsent) {
        if (reportResult.body?.bridgeMetrics !== undefined) {
          failures.push("run report bridgeMetrics should be absent for preview fallback.");
        }
      } else {
        if (
          reportResult.body?.bridgeMetrics?.attempts !==
          benchmarkCase.expected.bridgeMetrics.attempts
        ) {
          failures.push(
            `run report bridgeMetrics.attempts expected ${benchmarkCase.expected.bridgeMetrics.attempts} but received ${reportResult.body?.bridgeMetrics?.attempts ?? "(missing)"}.`,
          );
        }
        if (
          reportResult.body?.bridgeMetrics?.successes !==
          benchmarkCase.expected.bridgeMetrics.successes
        ) {
          failures.push(
            `run report bridgeMetrics.successes expected ${benchmarkCase.expected.bridgeMetrics.successes} but received ${reportResult.body?.bridgeMetrics?.successes ?? "(missing)"}.`,
          );
        }
        if (
          reportResult.body?.bridgeMetrics?.failures !==
          benchmarkCase.expected.bridgeMetrics.failures
        ) {
          failures.push(
            `run report bridgeMetrics.failures expected ${benchmarkCase.expected.bridgeMetrics.failures} but received ${reportResult.body?.bridgeMetrics?.failures ?? "(missing)"}.`,
          );
        }
      }
    }
    assertNoSecretLeak(
      JSON.stringify(reportResult.body ?? {}),
      ["SCRIPT_EXECUTION_API_KEY", bridgeSecret],
      "run report",
      failures,
    );

    const observationPath = join(
      workspaceRoot,
      ".director-angel",
      "runtime",
      "observations.ndjson",
    );
    const recordPath = join(
      workspaceRoot,
      ".director-angel",
      "runtime",
      "memory",
      "records",
      `record-${runIdValue}.json`,
    );
    const ingestPath = join(
      workspaceRoot,
      ".director-angel",
      "runtime",
      "memory",
      "ingest",
      `${runIdValue}.json`,
    );

    assertFileExists(observationPath, "observation log", failures);
    assertFileExists(recordPath, "memory record", failures);
    assertFileExists(ingestPath, "memory ingest audit", failures);

    let observationSources = [];
    if (existsSync(observationPath)) {
      const observations = readFileSync(observationPath, "utf8")
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
      observationSources = [
        ...new Set(observations.map((observation) => observation.source)),
      ].sort();
      for (const source of benchmarkCase.expected.observationSources ?? []) {
        if (!observationSources.includes(source)) {
          failures.push(`observation log missing source ${source}.`);
        }
      }
      const matchingEvaluation = observations.find(
        (observation) =>
          observation.source === "evaluation" &&
          observation.snapshotId === benchmarkCase.snapshot.snapshotId,
      );
      if (!matchingEvaluation) {
        failures.push("observation log should include the evaluation evidence for this snapshot.");
      }
    }

    let ingestAudit = null;
    if (existsSync(ingestPath)) {
      ingestAudit = readJson(ingestPath);
      if (ingestAudit.status !== benchmarkCase.expected.memoryStatus) {
        failures.push(
          `memory ingest status expected ${benchmarkCase.expected.memoryStatus} but received ${ingestAudit.status}.`,
        );
      }
      if (!Array.isArray(ingestAudit.observationIds) || ingestAudit.observationIds.length === 0) {
        failures.push("memory ingest audit should include at least one observationId.");
      }
    }

    let memoryRecord = null;
    if (existsSync(recordPath)) {
      memoryRecord = readJson(recordPath);
      if (memoryRecord.status !== benchmarkCase.expected.runStatus) {
        failures.push(
          `memory record status expected ${benchmarkCase.expected.runStatus} but received ${memoryRecord.status}.`,
        );
      }
      if (!memoryRecord.selectedAdapters?.includes(benchmarkCase.expected.adapterId)) {
        failures.push(
          `memory record should include selected adapter ${benchmarkCase.expected.adapterId}.`,
        );
      }
      if (!memoryRecord.digest?.selectedAdapters?.includes(benchmarkCase.expected.adapterId)) {
        failures.push(
          `memory digest should include selected adapter ${benchmarkCase.expected.adapterId}.`,
        );
      }
      for (const flag of benchmarkCase.expected.reportFlags ?? []) {
        if (!memoryRecord.digest?.flags?.includes(flag)) {
          failures.push(`memory digest flags should include ${flag}.`);
        }
      }
      for (const flag of benchmarkCase.expected.forbiddenReportFlags ?? []) {
        if (memoryRecord.digest?.flags?.includes(flag)) {
          failures.push(`memory digest flags should not include ${flag}.`);
        }
      }
      if (
        !Array.isArray(memoryRecord.digest?.observationRefs) ||
        memoryRecord.digest.observationRefs.length === 0
      ) {
        failures.push("memory digest should preserve observation refs for the execution evidence.");
      }
    }

    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    return {
      id: benchmarkCase.id,
      status: failures.length === 0 ? "passed" : "failed",
      durationMs: Number(durationMs.toFixed(2)),
      failures,
      reviewedBlueprint: reviewedBlueprint
        ? {
            blueprintId: reviewedBlueprint.blueprintId,
            handoffId: reviewedBlueprint.handoff?.handoffId,
            reviewDecision: reviewedBlueprint.review?.overallDecision,
            sideEffectsAllowed: reviewedBlueprint.handoff?.sideEffectsAllowed,
            chosenAdapters: reviewedBlueprint.handoff?.chosenAdapters ?? [],
            scriptPlanner:
              scriptPlanner === null
                ? null
                : {
                    assignmentId: scriptPlanner.assignmentId,
                    objective: scriptPlanner.objective,
                    deliverable: scriptPlanner.deliverable,
                    selectedAdapter: scriptPlanner.selectedAdapter,
                  },
          }
        : null,
      bridgeRequest:
        bridgeServer.requests.length === 0
          ? null
          : {
              authorizationMatched: bridgeServer.requests[0].authorizationMatched,
              body: bridgeServer.requests[0].body
                ? {
                    schemaId: bridgeServer.requests[0].body.schemaId,
                    assignmentId: bridgeServer.requests[0].body.assignmentId,
                    adapterId: bridgeServer.requests[0].body.adapterId,
                    role: bridgeServer.requests[0].body.role,
                    actionClass: bridgeServer.requests[0].body.actionClass,
                    workerId: bridgeServer.requests[0].body.workerId,
                  }
                : null,
            },
      runReport: reportResult.body ?? null,
      memoryIngestAudit: ingestAudit,
      memoryRecord,
      evidence: {
        runId: runIdValue,
        observationSources,
        bridgeRequests: bridgeServer.requests.length,
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
    "director-phase-p2-wave1-real-execution-adapter-handoff-gate-latest.json",
  );
  writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  process.stdout.write(
    `Director Phase P2 Wave 1 real execution handoff gate completed: ${caseResults.length} runs, failed ${failed.length}\n`,
  );
  process.stdout.write(`Report: ${latestPath}\n`);

  if (failed.length > 0) {
    fail(
      "Director Phase P2 Wave 1 real execution handoff gate failed.",
      failed.map((result) => `${result.id}: ${result.failures.join(" | ")}`).join("\n"),
    );
  }
}

await main();
