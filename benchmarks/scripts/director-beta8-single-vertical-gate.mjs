import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  getBenchmarksPaths,
  runHotflowCliCommand,
  runHotflowCliWithBuiltWorker as runHotflowCliWithBuiltWorkerCommand,
  runWorkspaceBuild,
} from "./cli-command.mjs";

const DIRECTOR_HOST_API_VERSION = "director-host-api.v1";
const pnpmBin = process.env.npm_execpath ?? (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const { benchmarksDir, repoRoot, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "director-beta8-single-vertical-gate.json");
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
      `Failed to build ${target} before Director Beta-8 single vertical gate.`,
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
    );
  }
}

function runHotflowCli(command, env) {
  return runHotflowCliCommand(command, env);
}

function runHotflowCliWithBuiltWorker(command, env) {
  return runHotflowCliWithBuiltWorkerCommand(command, env);
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

function extractRunId(stdout) {
  const match = stdout.match(/run id:\s*([^\n\r]+)/u);
  return match?.[1]?.trim() ?? null;
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

function buildSingleShotIntake(snapshot) {
  const objective =
    snapshot.project.outline ??
    snapshot.project.title ??
    `${snapshot.group.generationType} single-shot media request for ${snapshot.group.groupId}`;

  return {
    intakeId: `intake-${snapshot.snapshotId}`,
    submittedAt: snapshot.createdAt,
    objective,
    desiredOutcome: snapshot.project.outline,
    deliverables: ["Submit one single-shot media generation request."],
    constraints: (snapshot.locks?.lockedFields ?? []).map((lock) => ({
      field: lock.field,
      requirement: lock.reason ?? "Preserve the locked field during director planning.",
      priority: lock.level === "hard_lock" ? "required" : "preferred",
      ...(lock.reason === undefined ? {} : { rationale: lock.reason }),
    })),
    notes: ["Benchmark synthesized intake payload for Director Angel Beta-8."],
  };
}

function buildSingleShotAlignmentLock(snapshot, intake) {
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
    notes: ["Benchmark synthesized alignment lock for Director Angel Beta-8."],
  };
}

function normalizeBlueprintForWorkerExecution(blueprint, adapterId) {
  const normalizedNodes = Array.isArray(blueprint?.actionGraph?.nodes)
    ? blueprint.actionGraph.nodes.map((node) => {
        const isAssetRouter = node.role === "asset-router";
        return {
          ...node,
          approvalMode: isAssetRouter ? "operator_approve" : node.approvalMode,
          status: isAssetRouter ? "awaiting_approval" : node.status,
          ...(isAssetRouter
            ? {
                selectedAdapter: adapterId,
                allowedAdapters: [adapterId],
              }
            : {}),
        };
      })
    : [];

  const normalizedCapabilityMatches = Array.isArray(blueprint?.handoff?.capabilityMatches)
    ? blueprint.handoff.capabilityMatches.map((match) => {
        const isAssetRouter =
          normalizedNodes.find((node) => node.assignmentId === match.assignmentId)?.role ===
          "asset-router";
        return isAssetRouter
          ? {
              ...match,
              status: "matched",
              chosenAdapterId: adapterId,
              reasons: [`Selected adapter ${adapterId}.`],
            }
          : match;
      })
    : [];

  const requiredApprovals = normalizedNodes
    .filter((node) => node.approvalMode === "operator_approve")
    .map((node) => `${node.role}:${node.assignmentId}`);

  return {
    ...blueprint,
    preview: {
      ...(blueprint?.preview ?? {}),
      requiredApprovals,
      warnings: [
        ...new Set([
          ...(Array.isArray(blueprint?.preview?.warnings) ? blueprint.preview.warnings : []),
          "Benchmark records explicit operator approval before worker execution.",
        ]),
      ],
    },
    actionGraph: {
      ...blueprint.actionGraph,
      nodes: normalizedNodes,
    },
    handoff: {
      ...blueprint.handoff,
      sideEffectsAllowed: true,
      chosenAdapters: [
        ...new Set([
          ...(Array.isArray(blueprint?.handoff?.chosenAdapters)
            ? blueprint.handoff.chosenAdapters
            : []),
          adapterId,
        ]),
      ],
      capabilityMatches: normalizedCapabilityMatches,
      notes: [
        ...new Set([
          ...(Array.isArray(blueprint?.handoff?.notes) ? blueprint.handoff.notes : []),
          "Benchmark normalized reviewed blueprint for worker execution.",
        ]),
      ],
    },
  };
}

async function requestJson(url, options = {}) {
  const retries = options.retries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 150;
  const { retries: _retries, retryDelayMs: _retryDelayMs, ...requestOptions } = options;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...requestOptions,
        headers: {
          ...(requestOptions.body === undefined ? {} : { "content-type": "application/json" }),
          ...(requestOptions.headers ?? {}),
        },
      });
      const text = await response.text();
      let body = null;
      let parseError = null;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch (error) {
          parseError = error instanceof Error ? error.message : String(error);
        }
      }

      return {
        response,
        body,
        ...(parseError === null ? {} : { parseError }),
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await delay(retryDelayMs);
      }
    }
  }

  return {
    response: {
      ok: false,
      status: 0,
      statusText: lastError instanceof Error ? lastError.message : String(lastError),
    },
    body: null,
    fetchError:
      lastError instanceof Error ? (lastError.stack ?? lastError.message) : String(lastError),
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
    const parsedBody = body.length === 0 ? null : JSON.parse(body);
    requests.push({
      authorizationMatched: request.headers.authorization === `Bearer ${expectedSecret}`,
      body: parsedBody,
    });

    if (behavior.type === "timeout") {
      await delay(behavior.delayMs ?? 750);
      if (response.destroyed || response.writableEnded) {
        return;
      }
      try {
        response.writeHead(504, { "content-type": "application/json" });
        response.end(JSON.stringify({ accepted: false, reason: "timed_out" }));
      } catch {
        // Client already gave up after the benchmark timeout.
      }
      return;
    }

    response.writeHead(behavior.statusCode ?? 202, {
      "content-type": "application/json",
      ...(behavior.requestId === undefined ? {} : { "x-request-id": behavior.requestId }),
    });
    response.end(
      JSON.stringify({
        ...(behavior.accepted === undefined ? {} : { accepted: behavior.accepted }),
        ...(behavior.requestId === undefined ? {} : { requestId: behavior.requestId }),
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
  const workspaceRoot = mkdtempSync(join(tmpdir(), `director-beta8-${benchmarkCase.id}-`));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", `${benchmarkCase.id}.sqlite`);
  const commandRuns = [];
  const failures = [];
  const bridgeSecret = "bench-beta8-secret";
  let bridgeServer = null;
  let hostApi = null;
  let runIdValue = "missing-run-id";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });

  try {
    bridgeServer = await startBridgeServer(benchmarkCase.bridgeBehavior, bridgeSecret);
    const manifest = structuredClone(fixture.adapterManifest);
    manifest.bridge.baseUrl = bridgeServer.url;

    const manifestPath = join(workspaceRoot, "seedance-preview.json");
    const snapshotPath = join(workspaceRoot, "snapshot.json");
    const blueprintPath = join(workspaceRoot, "blueprint.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    writeFileSync(snapshotPath, `${JSON.stringify(benchmarkCase.snapshot, null, 2)}\n`, "utf8");
    writeSwitchDocument(workspaceRoot, {
      features: {
        "execution.sideEffects.enabled": true,
      },
    });

    const runtimeEnv = {
      HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      HOTFLOW_DATA_DIR: dataDir,
      HOTFLOW_DEFAULT_PROVIDER: "seedance",
      HOTFLOW_DEFAULT_MODEL: "hotflow-phase1",
      SEEDANCE_API_KEY: bridgeSecret,
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
        failures.push("runtime snapshot did not include the persisted bridge adapter.");
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
      }
    }

    const intake = buildSingleShotIntake(benchmarkCase.snapshot);
    const alignmentLock = buildSingleShotAlignmentLock(benchmarkCase.snapshot, intake);
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
    const routerNode =
      reviewedBlueprint?.actionGraph?.nodes?.find((node) => node.role === "asset-router") ?? null;
    if (!routerNode) {
      failures.push("reviewed blueprint did not include an asset-router node.");
    } else {
      if (routerNode.selectedAdapter !== benchmarkCase.expected.adapterId) {
        failures.push(
          `asset-router selectedAdapter expected ${benchmarkCase.expected.adapterId} but received ${routerNode.selectedAdapter ?? "(missing)"}.`,
        );
      }
      if (!routerNode.deliverable || !routerNode.objective) {
        failures.push("asset-router node should expose objective and deliverable.");
      }
    }
    if (reviewedBlueprint?.review?.overallDecision !== benchmarkCase.expected.reviewDecision) {
      failures.push(
        `reviewed blueprint overallDecision expected ${benchmarkCase.expected.reviewDecision} but received ${reviewedBlueprint?.review?.overallDecision ?? "(missing)"}.`,
      );
    }
    if (!reviewedBlueprint?.handoff?.chosenAdapters?.includes(benchmarkCase.expected.adapterId)) {
      failures.push(
        `reviewed blueprint handoff should include chosen adapter ${benchmarkCase.expected.adapterId}.`,
      );
    }

    const executableBlueprint = normalizeBlueprintForWorkerExecution(
      reviewedBlueprint,
      benchmarkCase.expected.adapterId,
    );
    writeFileSync(blueprintPath, `${JSON.stringify(executableBlueprint, null, 2)}\n`, "utf8");

    const createRun = runHotflowCli(
      ["director", "run", "create", "--input", blueprintPath, "--host", hostApi.baseUrl],
      cliEnv,
    );
    recordCommandRun(
      commandRuns,
      "run-create",
      ["director", "run", "create", "--input", blueprintPath, "--host", hostApi.baseUrl],
      createRun,
    );
    if (createRun.status !== 0) {
      failures.push(`director run create exited with ${createRun.status}.`);
    }
    verifyNeedles(createRun.stdout, "run create stdout", fixture.cliNeedles.runCreate, failures);

    const runId = extractRunId(createRun.stdout);
    if (!runId) {
      failures.push("Could not extract run id from director run create output.");
    } else {
      runIdValue = runId;
    }

    const startRun = runHotflowCli(
      ["director", "run", "start", "--run-id", runIdValue, "--host", hostApi.baseUrl],
      cliEnv,
    );
    recordCommandRun(
      commandRuns,
      "run-start",
      ["director", "run", "start", "--run-id", runIdValue, "--host", hostApi.baseUrl],
      startRun,
    );
    if (startRun.status !== 0) {
      failures.push(`director run start exited with ${startRun.status}.`);
    }
    verifyNeedles(startRun.stdout, "run start stdout", fixture.cliNeedles.runStart, failures);

    const startedRunResult = await requestJson(
      `${hostApi.baseUrl}/v1/runs/${encodeURIComponent(runIdValue)}`,
    );
    if (!startedRunResult.response.ok) {
      failures.push(`/v1/runs/:runId returned ${startedRunResult.response.status} before approve.`);
    }
    const approvalAssignmentIds = (
      Array.isArray(startedRunResult.body?.assignments) ? startedRunResult.body.assignments : []
    )
      .filter(
        (assignment) =>
          assignment.status === "pending" && assignment.approvalMode === "operator_approve",
      )
      .map((assignment) => assignment.assignmentId);
    if (approvalAssignmentIds.length === 0 && routerNode?.assignmentId) {
      approvalAssignmentIds.push(routerNode.assignmentId);
    }

    for (const assignmentId of approvalAssignmentIds) {
      const approveCommand = [
        "director",
        "run",
        "approve",
        "--run-id",
        runIdValue,
        "--assignment-id",
        assignmentId,
        "--host",
        hostApi.baseUrl,
      ];
      const approveRun = runHotflowCli(approveCommand, cliEnv);
      recordCommandRun(commandRuns, `run-approve-${assignmentId}`, approveCommand, approveRun);
      if (approveRun.status !== 0) {
        failures.push(`director run approve ${assignmentId} exited with ${approveRun.status}.`);
      }
    }

    let lastWorkerPayload = null;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
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
        cliEnv,
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
        "director run once did not drive the run to a terminal status within 8 passes.",
      );
    } else if (lastWorkerPayload.status !== benchmarkCase.expected.runStatus) {
      failures.push(
        `worker terminal status expected ${benchmarkCase.expected.runStatus} but received ${lastWorkerPayload.status}.`,
      );
    }

    if (bridgeServer.requests.length !== 1) {
      failures.push(
        `bridge server expected 1 request but received ${bridgeServer.requests.length}.`,
      );
    } else {
      const bridgeRequest = bridgeServer.requests[0];
      if (!bridgeRequest.authorizationMatched) {
        failures.push("bridge server did not receive the expected bearer credential.");
      }
      if (bridgeRequest.body?.schemaId !== "director.execution.http-json-request.v1") {
        failures.push(
          `bridge request schemaId expected director.execution.http-json-request.v1 but received ${bridgeRequest.body?.schemaId ?? "(missing)"}.`,
        );
      }
      if (bridgeRequest.body?.adapterId !== benchmarkCase.expected.adapterId) {
        failures.push(
          `bridge request adapterId expected ${benchmarkCase.expected.adapterId} but received ${bridgeRequest.body?.adapterId ?? "(missing)"}.`,
        );
      }
      if (routerNode && bridgeRequest.body?.assignmentId !== routerNode.assignmentId) {
        failures.push(
          `bridge request assignmentId expected ${routerNode.assignmentId} but received ${bridgeRequest.body?.assignmentId ?? "(missing)"}.`,
        );
      }
      if (routerNode && bridgeRequest.body?.objective !== routerNode.objective) {
        failures.push("bridge request objective should match the routed asset-router objective.");
      }
      if (routerNode && bridgeRequest.body?.deliverable !== routerNode.deliverable) {
        failures.push(
          "bridge request deliverable should match the routed asset-router deliverable.",
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
      const bridgeExecution =
        runResult.body?.assignments?.find((assignment) => assignment.role === "asset-router")
          ?.result?.bridgeExecution ?? null;
      if (!bridgeExecution) {
        failures.push("final run should include bridgeExecution on the asset-router assignment.");
      } else if (benchmarkCase.bridgeBehavior.type === "success") {
        if (bridgeExecution.response?.statusCode !== benchmarkCase.bridgeBehavior.statusCode) {
          failures.push(
            `bridgeExecution.response.statusCode expected ${benchmarkCase.bridgeBehavior.statusCode} but received ${bridgeExecution.response?.statusCode ?? "(missing)"}.`,
          );
        }
        if (bridgeExecution.response?.requestId !== benchmarkCase.bridgeBehavior.requestId) {
          failures.push(
            `bridgeExecution.response.requestId expected ${benchmarkCase.bridgeBehavior.requestId} but received ${bridgeExecution.response?.requestId ?? "(missing)"}.`,
          );
        }
      } else {
        if (bridgeExecution.failure?.reason !== "network_timeout") {
          failures.push(
            `bridgeExecution.failure.reason expected network_timeout but received ${bridgeExecution.failure?.reason ?? "(missing)"}.`,
          );
        }
        if (bridgeExecution.failure?.statusCode !== 504) {
          failures.push(
            `bridgeExecution.failure.statusCode expected 504 but received ${bridgeExecution.failure?.statusCode ?? "(missing)"}.`,
          );
        }
        if (bridgeExecution.failure?.retryable !== true) {
          failures.push("bridgeExecution.failure.retryable should be true for timeout failures.");
        }
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
    const expectedReportNeedles = [
      "Director run report:",
      ...(routerNode === null
        ? []
        : [`objective: ${routerNode.objective}`, `deliverable: ${routerNode.deliverable}`]),
      ...benchmarkCase.expected.runReportNeedles,
    ];
    verifyNeedles(reportRun.stdout, "run report stdout", expectedReportNeedles, failures);
    assertNoSecretLeak(
      reportRun.stdout,
      ["SEEDANCE_API_KEY", bridgeSecret],
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
      if (
        reportResult.body?.bridgeMetrics?.attempts !== benchmarkCase.expected.bridgeMetrics.attempts
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
        reportResult.body?.bridgeMetrics?.failures !== benchmarkCase.expected.bridgeMetrics.failures
      ) {
        failures.push(
          `run report bridgeMetrics.failures expected ${benchmarkCase.expected.bridgeMetrics.failures} but received ${reportResult.body?.bridgeMetrics?.failures ?? "(missing)"}.`,
        );
      }
    }
    assertNoSecretLeak(
      JSON.stringify(reportResult.body ?? {}),
      ["SEEDANCE_API_KEY", bridgeSecret],
      "run report",
      failures,
    );

    const observationPath = join(
      workspaceRoot,
      ".director-angel",
      "runtime",
      "observations.ndjson",
    );
    const reportPath = join(
      workspaceRoot,
      ".director-angel",
      "runtime",
      "execution",
      "runs",
      runIdValue,
      "report.json",
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
    assertFileExists(reportPath, "run report", failures);
    const expectsMemoryRecord = benchmarkCase.expected.memoryRecordExpected !== false;
    if (expectsMemoryRecord) {
      assertFileExists(recordPath, "memory record", failures);
    } else if (existsSync(recordPath)) {
      failures.push(
        `memory record should not be written for ${benchmarkCase.expected.memoryStatus} ingest.`,
      );
    }
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
    if (expectsMemoryRecord && existsSync(recordPath)) {
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
      if (
        !Array.isArray(memoryRecord.digest?.observationRefs) ||
        memoryRecord.digest.observationRefs.length === 0
      ) {
        failures.push("memory digest should preserve observation refs for the vertical evidence.");
      }
    }

    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    return {
      id: benchmarkCase.id,
      status: failures.length === 0 ? "passed" : "failed",
      durationMs: Number(durationMs.toFixed(2)),
      failures,
      evidence: {
        runId: runIdValue,
        observationSources,
        reportPath,
        recordPath,
        ingestPath,
      },
      runtimeSnapshotAdapter:
        runtimeSnapshot.body?.capabilitySnapshot?.adapters?.find(
          (entry) => entry.adapterId === benchmarkCase.expected.adapterId,
        ) ?? null,
      reviewedBlueprint: reviewedBlueprint
        ? {
            blueprintId: reviewedBlueprint.blueprintId,
            handoffId: reviewedBlueprint.handoff?.handoffId,
            reviewDecision: reviewedBlueprint.review?.overallDecision,
            chosenAdapters: reviewedBlueprint.handoff?.chosenAdapters ?? [],
            assetRouter:
              routerNode === null
                ? null
                : {
                    assignmentId: routerNode.assignmentId,
                    objective: routerNode.objective,
                    deliverable: routerNode.deliverable,
                    selectedAdapter: routerNode.selectedAdapter,
                  },
          }
        : null,
      bridgeRequest: bridgeServer.requests[0]
        ? {
            authorizationMatched: bridgeServer.requests[0].authorizationMatched,
            body: bridgeServer.requests[0].body
              ? {
                  schemaId: bridgeServer.requests[0].body.schemaId,
                  assignmentId: bridgeServer.requests[0].body.assignmentId,
                  adapterId: bridgeServer.requests[0].body.adapterId,
                  workerId: bridgeServer.requests[0].body.workerId,
                  objective: bridgeServer.requests[0].body.objective,
                  deliverable: bridgeServer.requests[0].body.deliverable,
                }
              : null,
          }
        : null,
      runReport: reportResult.body ?? null,
      memoryIngestAudit: ingestAudit,
      memoryRecord,
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

  const latestPath = resolve(resultsDir, "director-beta8-single-vertical-gate-latest.json");
  writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  process.stdout.write(
    `Director Beta-8 single vertical gate completed: ${caseResults.length} runs, failed ${failed.length}\n`,
  );
  process.stdout.write(`Report: ${latestPath}\n`);

  if (failed.length > 0) {
    fail(
      "Director Beta-8 single vertical gate failed.",
      failed.map((result) => `${result.id}: ${result.failures.join(" | ")}`).join("\n"),
    );
  }
}

await main();
