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

const pnpmBin = process.env.npm_execpath ?? (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const { benchmarksDir, repoRoot, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(
  benchmarksDir,
  "fixtures",
  "director-beta7-wave2-real-adapter-bridge-gate.json",
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
      `Failed to build ${target} before Director Beta-7 Wave 2 gate.`,
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

  return { response, body };
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
  };
}

async function startBridgeServer(expectedSecret) {
  const requests = [];
  const server = createHttpServer(async (request, response) => {
    const body = await readRequestBody(request);
    requests.push({
      authorizationMatched: request.headers.authorization === `Bearer ${expectedSecret}`,
      body: body.length === 0 ? null : JSON.parse(body),
    });
    response.writeHead(202, {
      "content-type": "application/json",
      "x-request-id": "req-beta7-wave2-1",
    });
    response.end(JSON.stringify({ accepted: true }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
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

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function writeSwitchDocument(workspaceRoot, overrides) {
  mkdirSync(join(workspaceRoot, ".director-angel", "runtime"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, ".director-angel", "runtime", "switches.json"),
    `${JSON.stringify({ schemaId: "director.switches.v1", ...overrides }, null, 2)}\n`,
    "utf8",
  );
}

function writeObservationFixture(workspaceRoot, observations) {
  writeFileSync(
    join(workspaceRoot, ".director-angel", "runtime", "observations.ndjson"),
    `${observations.map((observation) => JSON.stringify(observation)).join("\n")}\n`,
    "utf8",
  );
}

function createEvaluationObservationFixture() {
  return {
    schemaId: "director.observation.v1",
    observationId: "observation-evaluation-1",
    recordedAt: "2026-04-13T16:25:00.000Z",
    source: "evaluation",
    snapshotId: fixture.reviewedBlueprint.snapshotId,
    runtimeId: fixture.reviewedBlueprint.runtimeId,
    workingContext: {
      snapshotId: fixture.reviewedBlueprint.snapshotId,
      runtimeId: fixture.reviewedBlueprint.runtimeId,
      operatorId: "operator-wave2",
      goal: fixture.reviewedBlueprint.actionGraph.goal,
      projectLabel: "Wave 2 bridge gate",
      projectId: "project-wave2",
      groupId: "group-wave2",
      generationType: "new",
      generationStyle: "immersive",
      sceneCount: 1,
      continuityPriority: "high",
      anchorIds: ["anchor-wave2"],
    },
    recallHints: {
      preferredBindings: ["seedance-preview"],
      requiredBindings: [],
      fallbackBindings: [],
      continuityAnchorIds: ["anchor-wave2"],
      knowledgeSignalTags: ["bridge", "execution"],
      deliverables: ["send a bounded adapter request"],
    },
    recalledKnowledgePacks: [],
    recallStatus: "disabled",
    recallNotes: ["Gate fixture disables recall."],
    evaluation: {
      decision: "pass",
      actionGraphReadiness: "ready",
      selectedAdapters: [fixture.expected.adapterId],
      blockedReasons: [],
      warnings: [],
    },
    notes: ["fixture=evaluation"],
  };
}

function createOutcomeObservationFixture() {
  return {
    schemaId: "director.observation.v1",
    observationId: "observation-outcome-1",
    recordedAt: "2026-04-13T16:26:00.000Z",
    source: "outcome",
    snapshotId: fixture.reviewedBlueprint.snapshotId,
    runtimeId: fixture.reviewedBlueprint.runtimeId,
    blueprintId: fixture.reviewedBlueprint.blueprintId,
    handoffId: fixture.reviewedBlueprint.handoff.handoffId,
    recalledKnowledgePacks: [],
    recallStatus: "disabled",
    recallNotes: ["Gate fixture disables recall."],
    outcome: {
      outcomeId: "outcome-wave2-1",
      status: "accepted",
      recordedAt: "2026-04-13T16:26:00.000Z",
      operatorId: "operator-wave2",
      notes: ["Bridge gate accepted."],
    },
    notes: ["fixture=outcome"],
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function main() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "director-beta7-wave2-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "director-beta7-wave2.sqlite");
  const commandRuns = [];
  const failures = [];
  const bridgeSecret = "bench-wave2-secret";
  let bridgeServer = null;
  let hostApi = null;

  mkdirSync(join(dataDir, "sessions"), { recursive: true });

  try {
    for (const target of [
      "@hotflow/director-host-contracts",
      "@hotflow/director-runtime",
      "@hotflow/director-execution",
      "@hotflow/director-workspace",
      "@hotflow/director-worker",
    ]) {
      runBuild(target);
    }

    bridgeServer = await startBridgeServer(bridgeSecret);
    const manifest = structuredClone(fixture.adapterManifest);
    manifest.bridge.baseUrl = bridgeServer.url;

    const manifestPath = join(workspaceRoot, "seedance-preview.json");
    const blueprintPath = join(workspaceRoot, "blueprint.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    writeFileSync(blueprintPath, `${JSON.stringify(fixture.reviewedBlueprint, null, 2)}\n`, "utf8");

    const runtimeEnv = {
      HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      HOTFLOW_DATA_DIR: dataDir,
      HOTFLOW_DEFAULT_PROVIDER: "scripted",
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

    const explainBefore = runHotflowCli(
      ["director", "adapters", "explain", "--adapter-id", fixture.expected.adapterId],
      cliEnv,
    );
    recordCommandRun(
      commandRuns,
      "explain-before",
      ["director", "adapters", "explain", "--adapter-id", fixture.expected.adapterId],
      explainBefore,
    );
    if (explainBefore.status !== 0) {
      failures.push(`explain-before command exited with ${explainBefore.status}.`);
    }
    verifyNeedles(
      explainBefore.stdout,
      "explain-before stdout",
      fixture.cliNeedles.explainBefore,
      failures,
    );
    assertNoSecretLeak(
      explainBefore.stdout,
      ["SEEDANCE_API_KEY", bridgeSecret],
      "explain-before stdout",
      failures,
    );

    writeSwitchDocument(workspaceRoot, {
      features: {
        "execution.sideEffects.enabled": true,
      },
    });
    writeObservationFixture(workspaceRoot, [
      createEvaluationObservationFixture(),
      createOutcomeObservationFixture(),
    ]);

    const explainAfter = runHotflowCli(
      ["director", "adapters", "explain", "--adapter-id", fixture.expected.adapterId],
      cliEnv,
    );
    recordCommandRun(
      commandRuns,
      "explain-after",
      ["director", "adapters", "explain", "--adapter-id", fixture.expected.adapterId],
      explainAfter,
    );
    if (explainAfter.status !== 0) {
      failures.push(`explain-after command exited with ${explainAfter.status}.`);
    }
    verifyNeedles(
      explainAfter.stdout,
      "explain-after stdout",
      fixture.cliNeedles.explainAfter,
      failures,
    );
    assertNoSecretLeak(
      explainAfter.stdout,
      ["SEEDANCE_API_KEY", bridgeSecret],
      "explain-after stdout",
      failures,
    );

    hostApi = await startDirectorHostApi(hostEnv);

    const runtimeSnapshot = await requestJson(`${hostApi.baseUrl}/v1/runtime/snapshot`);
    if (!runtimeSnapshot.response.ok) {
      failures.push(`/v1/runtime/snapshot returned ${runtimeSnapshot.response.status}.`);
    }

    const adapter =
      runtimeSnapshot.body?.capabilitySnapshot?.adapters?.find(
        (entry) => entry.adapterId === fixture.expected.adapterId,
      ) ?? null;
    if (!adapter) {
      failures.push("runtime snapshot did not include the persisted bridge adapter.");
    } else {
      if (adapter.bridge?.authMode !== fixture.expected.bridgeAuthMode) {
        failures.push(
          `runtime snapshot bridge authMode expected ${fixture.expected.bridgeAuthMode} but received ${adapter.bridge?.authMode ?? "(missing)"}.`,
        );
      }
      if (adapter.bridge?.endpointPath !== fixture.expected.bridgePath) {
        failures.push(
          `runtime snapshot bridge path expected ${fixture.expected.bridgePath} but received ${adapter.bridge?.endpointPath ?? "(missing)"}.`,
        );
      }
      if (adapter.bridge?.kind !== "http-json") {
        failures.push(
          `runtime snapshot bridge kind expected http-json but received ${adapter.bridge?.kind ?? "(missing)"}.`,
        );
      }
      if (adapter.bridge?.headerKeys?.includes("x-bridge-id") !== true) {
        failures.push("runtime snapshot bridge headerKeys should include x-bridge-id.");
      }
    }
    assertNoSecretLeak(
      JSON.stringify(runtimeSnapshot.body ?? {}),
      ["SEEDANCE_API_KEY", bridgeSecret],
      "runtime snapshot",
      failures,
    );

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
    }
    const runIdValue = runId ?? "missing-run-id";

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

    const approveRun = runHotflowCli(
      [
        "director",
        "run",
        "approve",
        "--run-id",
        runIdValue,
        "--assignment-id",
        "assignment-bridge-1",
        "--host",
        hostApi.baseUrl,
      ],
      cliEnv,
    );
    recordCommandRun(
      commandRuns,
      "run-approve",
      [
        "director",
        "run",
        "approve",
        "--run-id",
        runIdValue,
        "--assignment-id",
        "assignment-bridge-1",
        "--host",
        hostApi.baseUrl,
      ],
      approveRun,
    );
    if (approveRun.status !== 0) {
      failures.push(`director run approve exited with ${approveRun.status}.`);
    }

    const workerRun = await runHotflowCliWithBuiltWorker(
      [
        "director",
        "run",
        "once",
        "--run-id",
        runIdValue,
        "--worker-id",
        "bench-beta7-wave2-worker",
      ],
      workerEnv,
    );
    recordCommandRun(
      commandRuns,
      "director-run-once",
      [
        "director",
        "run",
        "once",
        "--run-id",
        runIdValue,
        "--worker-id",
        "bench-beta7-wave2-worker",
      ],
      workerRun,
    );
    if (workerRun.status !== 0) {
      failures.push(`director run once exited with ${workerRun.status}.`);
    }
    const workerPayload = coerceJson(workerRun.stdout);
    if (!workerPayload) {
      failures.push("director run once output did not include valid JSON.");
    } else {
      for (const flag of fixture.expected.workerFlags ?? []) {
        if (!workerPayload.flags?.includes(flag)) {
          failures.push(`worker report flags should include ${flag}.`);
        }
      }
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
      if (bridgeRequest.body?.adapterId !== fixture.expected.adapterId) {
        failures.push(
          `bridge request adapterId expected ${fixture.expected.adapterId} but received ${bridgeRequest.body?.adapterId ?? "(missing)"}.`,
        );
      }
      if (bridgeRequest.body?.assignmentId !== "assignment-bridge-1") {
        failures.push(
          `bridge request assignmentId expected assignment-bridge-1 but received ${bridgeRequest.body?.assignmentId ?? "(missing)"}.`,
        );
      }
    }

    const runResult = await requestJson(
      `${hostApi.baseUrl}/v1/runs/${encodeURIComponent(runIdValue)}`,
    );
    if (!runResult.response.ok) {
      failures.push(`/v1/runs/:runId returned ${runResult.response.status}.`);
    } else if (
      runResult.body?.assignments?.[0]?.result?.bridgeExecution?.response?.statusCode !== 202
    ) {
      failures.push("final run should include bridgeExecution.response.statusCode=202.");
    }

    const reportResult = await requestJson(
      `${hostApi.baseUrl}/v1/runs/${encodeURIComponent(runIdValue)}/report`,
    );
    if (!reportResult.response.ok) {
      failures.push(`/v1/runs/:runId/report returned ${reportResult.response.status}.`);
    } else {
      for (const flag of fixture.expected.reportFlags ?? []) {
        if (!reportResult.body?.flags?.includes(flag)) {
          failures.push(`run report flags should include ${flag}.`);
        }
      }
      if (reportResult.body?.bridgeMetrics?.attempts !== 1) {
        failures.push(
          `run report bridgeMetrics.attempts expected 1 but received ${reportResult.body?.bridgeMetrics?.attempts ?? "(missing)"}.`,
        );
      }
      if (reportResult.body?.bridgeMetrics?.successes !== 1) {
        failures.push(
          `run report bridgeMetrics.successes expected 1 but received ${reportResult.body?.bridgeMetrics?.successes ?? "(missing)"}.`,
        );
      }
    }
    assertNoSecretLeak(
      JSON.stringify(reportResult.body ?? {}),
      ["SEEDANCE_API_KEY", bridgeSecret],
      "run report",
      failures,
    );

    const memoryAuditPath = join(
      workspaceRoot,
      ".director-angel",
      "runtime",
      "memory",
      "ingest",
      `${runIdValue}.json`,
    );
    if (!existsSync(memoryAuditPath)) {
      failures.push(`memory ingest audit was not written: ${memoryAuditPath}`);
    } else {
      const memoryAudit = readJson(memoryAuditPath);
      if (memoryAudit.status !== fixture.expected.memoryIngestStatus) {
        failures.push(
          `memory ingest status expected ${fixture.expected.memoryIngestStatus} but received ${memoryAudit.status}.`,
        );
      }
    }

    const resultPath = join(
      resultsDir,
      `director-beta7-wave2-real-adapter-bridge-gate-${Date.now()}.json`,
    );
    writeFileSync(
      resultPath,
      `${JSON.stringify(
        {
          gateId: fixture.suiteId,
          status: failures.length === 0 ? "pass" : "fail",
          workspaceRoot,
          commandRuns,
          runtimeSnapshotAdapter: adapter,
          bridgeRequest: bridgeServer.requests[0]
            ? {
                authorizationMatched: bridgeServer.requests[0].authorizationMatched,
                body: bridgeServer.requests[0].body
                  ? {
                      schemaId: bridgeServer.requests[0].body.schemaId,
                      assignmentId: bridgeServer.requests[0].body.assignmentId,
                      adapterId: bridgeServer.requests[0].body.adapterId,
                      workerId: bridgeServer.requests[0].body.workerId,
                    }
                  : null,
              }
            : null,
          runReport: reportResult.body,
          memoryIngestStatus: existsSync(memoryAuditPath)
            ? readJson(memoryAuditPath).status
            : "missing",
          failures,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    if (failures.length > 0) {
      fail("Director Beta-7 Wave 2 real adapter bridge gate failed.", failures.join("\n"));
    }

    process.stdout.write(
      `Director Beta-7 Wave 2 real adapter bridge gate passed.\nResult: ${resultPath}\n`,
    );
  } catch (error) {
    const details = error instanceof Error ? (error.stack ?? error.message) : String(error);
    fail("Director Beta-7 Wave 2 real adapter bridge gate crashed.", details);
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

await main();
