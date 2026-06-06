import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  getBenchmarksPaths,
  runHotflowCliCommand,
  runHotflowCliWithBuiltWorker,
} from "./cli-command.mjs";

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const { benchmarksDir, repoRoot, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(
  benchmarksDir,
  "fixtures",
  "director-beta4-trace-to-proposal-gate.json",
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

function runHotflowCli(_repoRootPath, command, env) {
  return runHotflowCliCommand(command, env);
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

function verifyNeedles(output, label, needles, failures) {
  for (const needle of needles) {
    if (!output.includes(needle)) {
      failures.push(`${label} should include "${needle}".`);
    }
  }
}

function assertFileExists(path, label, failures) {
  if (!existsSync(path)) {
    failures.push(`Missing ${label}: ${path}`);
  }
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

function isTerminalRunStatus(status) {
  return status === "completed" || status === "failed" || status === "aborted";
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
        // keep polling
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

function buildDefaultIntake(snapshot) {
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
    constraints: [],
    notes: ["Benchmark synthesized intake for Director Beta-4 trace-proposal gate."],
  };
}

function buildDefaultAlignmentLock(snapshot, intake) {
  return {
    lockId: `lock-${snapshot.snapshotId}`,
    sourceIntakeId: intake.intakeId,
    state: "locked",
    lockedAt: snapshot.createdAt,
    objective: intake.objective,
    ...(intake.desiredOutcome === undefined ? {} : { desiredOutcome: intake.desiredOutcome }),
    deliverables: intake.deliverables,
    lockedConstraints: intake.constraints,
    lockedFields: snapshot.locks?.lockedFields ?? [],
    notes: ["Benchmark synthesized alignment lock for Director Beta-4 trace-proposal gate."],
  };
}

function normalizeBlueprintForPreviewExecution(blueprint) {
  const normalizedNodes = Array.isArray(blueprint?.actionGraph?.nodes)
    ? blueprint.actionGraph.nodes.map((node) => ({
        ...node,
        approvalMode: node.approvalMode === "operator_approve" ? "auto_allow" : node.approvalMode,
      }))
    : [];

  return {
    ...blueprint,
    preview: {
      ...(blueprint?.preview ?? {}),
      requiredApprovals: [],
      warnings: [
        ...new Set([
          ...(Array.isArray(blueprint?.preview?.warnings) ? blueprint.preview.warnings : []),
          "Benchmark normalized operator approvals into preview-safe auto_allow execution.",
        ]),
      ],
    },
    actionGraph: {
      ...blueprint.actionGraph,
      nodes: normalizedNodes,
    },
  };
}

async function runCase(benchmarkCase) {
  const started = process.hrtime.bigint();
  const workspaceRoot = mkdtempSync(join(tmpdir(), `director-beta4-${benchmarkCase.id}-`));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", `${benchmarkCase.id}.sqlite`);
  const snapshotPath = join(workspaceRoot, "snapshot.json");
  const blueprintPath = join(workspaceRoot, "blueprint.json");
  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(snapshotPath, JSON.stringify(benchmarkCase.snapshot, null, 2));

  const runtimeEnv = {
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_DEFAULT_PROVIDER: "scripted",
    HOTFLOW_DEFAULT_MODEL: "hotflow-phase1",
  };
  const cliEnv = {
    ...process.env,
    ...runtimeEnv,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
  };
  const workerEnv = {
    ...process.env,
    ...runtimeEnv,
  };

  const failures = [];
  const commandRuns = [];
  let hostApi = null;
  let runIdValue = "missing-run-id";

  try {
    hostApi = await startDirectorHostApi(runtimeEnv);

    const intake = buildDefaultIntake(benchmarkCase.snapshot);
    const alignmentLock = buildDefaultAlignmentLock(benchmarkCase.snapshot, intake);

    const blueprintResponse = await requestJson(`${hostApi.baseUrl}/v1/blueprint`, {
      method: "POST",
      body: JSON.stringify({
        apiVersion: "director-host-api.v1",
        snapshot: benchmarkCase.snapshot,
        intake,
        alignmentLock,
      }),
    });

    if (!blueprintResponse.response.ok) {
      throw new Error(
        `/v1/blueprint failed (${blueprintResponse.response.status}): ${JSON.stringify(blueprintResponse.body)}`,
      );
    }

    writeFileSync(
      blueprintPath,
      JSON.stringify(normalizeBlueprintForPreviewExecution(blueprintResponse.body), null, 2),
    );

    const createRun = runHotflowCli(
      repoRoot,
      ["director", "run", "create", "--input", blueprintPath, "--host", hostApi.baseUrl],
      cliEnv,
    );
    recordCommandRun(
      commandRuns,
      "director-run-create",
      ["director", "run", "create", "--input", blueprintPath, "--host", hostApi.baseUrl],
      createRun,
    );
    if (createRun.status !== 0) {
      failures.push(`director run create exit status expected 0 but received ${createRun.status}.`);
    }
    verifyNeedles(
      createRun.stdout,
      "director run create",
      ["Director run:", "status: created"],
      failures,
    );

    const runId = extractRunId(createRun.stdout);
    if (!runId) {
      failures.push("Could not extract run id from director run create output.");
    } else {
      runIdValue = runId;
    }

    const startRun = runHotflowCli(
      repoRoot,
      ["director", "run", "start", "--run-id", runIdValue, "--host", hostApi.baseUrl],
      cliEnv,
    );
    recordCommandRun(
      commandRuns,
      "director-run-start",
      ["director", "run", "start", "--run-id", runIdValue, "--host", hostApi.baseUrl],
      startRun,
    );
    if (startRun.status !== 0) {
      failures.push(`director run start exit status expected 0 but received ${startRun.status}.`);
    }
    verifyNeedles(
      startRun.stdout,
      "director run start",
      ["Director run:", "status: running"],
      failures,
    );

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
          `bench-beta4-main-${attempt}`,
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
          `bench-beta4-main-${attempt}`,
        ],
        workerRun,
      );
      if (workerRun.status !== 0) {
        failures.push(
          `director run once attempt ${attempt} exit status expected 0 but received ${workerRun.status}.`,
        );
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
    }

    const reportRun = runHotflowCli(
      repoRoot,
      ["director", "run", "report", "--run-id", runIdValue, "--host", hostApi.baseUrl],
      cliEnv,
    );
    recordCommandRun(
      commandRuns,
      "director-run-report",
      ["director", "run", "report", "--run-id", runIdValue, "--host", hostApi.baseUrl],
      reportRun,
    );
    if (reportRun.status !== 0) {
      failures.push(`director run report exit status expected 0 but received ${reportRun.status}.`);
    }
    verifyNeedles(
      reportRun.stdout,
      "director run report",
      benchmarkCase.expected.reportNeedles,
      failures,
    );

    const directorStatus = runHotflowCli(repoRoot, ["director", "status"], cliEnv);
    recordCommandRun(commandRuns, "director-status", ["director", "status"], directorStatus);
    if (directorStatus.status !== 0) {
      failures.push(
        `director status exit status expected 0 but received ${directorStatus.status}.`,
      );
    }
    verifyNeedles(
      directorStatus.stdout,
      "director status",
      benchmarkCase.expected.statusNeedles,
      failures,
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
    const proposalIndexPath = join(
      workspaceRoot,
      ".director-angel",
      "runtime",
      "proposals",
      "index.json",
    );

    assertFileExists(recordPath, "memory record", failures);
    assertFileExists(ingestPath, "memory ingest audit", failures);
    assertFileExists(proposalIndexPath, "proposal index", failures);

    let proposalPath = null;
    let proposalId = null;
    let proposalAuditPath = null;
    if (existsSync(proposalIndexPath)) {
      const proposalIndex = JSON.parse(readFileSync(proposalIndexPath, "utf8"));
      proposalId = proposalIndex.entries?.[0]?.proposalId ?? null;
      if (typeof proposalId !== "string") {
        failures.push("Proposal index did not contain a proposalId entry.");
      } else {
        proposalAuditPath = join(
          workspaceRoot,
          ".director-angel",
          "runtime",
          "proposals",
          "audits",
          `${proposalId}.ndjson`,
        );
        proposalPath = join(
          workspaceRoot,
          ".director-angel",
          "runtime",
          "proposals",
          "records",
          `${proposalId}.json`,
        );
        assertFileExists(proposalPath, "proposal record", failures);

        if (existsSync(proposalPath) && existsSync(recordPath)) {
          const proposal = JSON.parse(readFileSync(proposalPath, "utf8"));
          const record = JSON.parse(readFileSync(recordPath, "utf8"));

          if (proposal.recordId !== record.recordId) {
            failures.push(
              `Proposal recordId expected ${record.recordId} but received ${proposal.recordId}.`,
            );
          }
          if (proposal.runId !== runIdValue) {
            failures.push(`Proposal runId expected ${runIdValue} but received ${proposal.runId}.`);
          }
          if (proposal.status !== "pending") {
            failures.push(`Proposal status expected pending but received ${proposal.status}.`);
          }
        }
      }
    }

    const traceProposalStatus = runHotflowCli(
      repoRoot,
      ["director", "trace-proposal", "status"],
      cliEnv,
    );
    recordCommandRun(
      commandRuns,
      "director-trace-proposal-status",
      ["director", "trace-proposal", "status"],
      traceProposalStatus,
    );
    if (traceProposalStatus.status !== 0) {
      failures.push(
        `director trace-proposal status exit status expected 0 but received ${traceProposalStatus.status}.`,
      );
    }
    verifyNeedles(
      traceProposalStatus.stdout,
      "director trace-proposal status",
      benchmarkCase.expected.traceProposalStatusNeedles,
      failures,
    );

    const traceProposalList = runHotflowCli(
      repoRoot,
      [
        "director",
        "trace-proposal",
        "list",
        "--project-id",
        benchmarkCase.snapshot.project.projectId,
      ],
      cliEnv,
    );
    recordCommandRun(
      commandRuns,
      "director-trace-proposal-list",
      [
        "director",
        "trace-proposal",
        "list",
        "--project-id",
        benchmarkCase.snapshot.project.projectId,
      ],
      traceProposalList,
    );
    if (traceProposalList.status !== 0) {
      failures.push(
        `director trace-proposal list exit status expected 0 but received ${traceProposalList.status}.`,
      );
    }
    verifyNeedles(
      traceProposalList.stdout,
      "director trace-proposal list",
      benchmarkCase.expected.traceProposalListNeedles,
      failures,
    );

    if (typeof proposalId === "string") {
      const traceProposalReview = runHotflowCli(
        repoRoot,
        ["director", "trace-proposal", "review", "--proposal-id", proposalId],
        cliEnv,
      );
      recordCommandRun(
        commandRuns,
        "director-trace-proposal-review",
        ["director", "trace-proposal", "review", "--proposal-id", proposalId],
        traceProposalReview,
      );
      if (traceProposalReview.status !== 0) {
        failures.push(
          `director trace-proposal review exit status expected 0 but received ${traceProposalReview.status}.`,
        );
      }
      verifyNeedles(
        traceProposalReview.stdout,
        "director trace-proposal review",
        benchmarkCase.expected.traceProposalReviewNeedles,
        failures,
      );

      const traceProposalAccept = runHotflowCli(
        repoRoot,
        [
          "director",
          "trace-proposal",
          "accept",
          "--proposal-id",
          proposalId,
          "--note",
          "approved_from_beta4_gate",
        ],
        cliEnv,
      );
      recordCommandRun(
        commandRuns,
        "director-trace-proposal-accept",
        [
          "director",
          "trace-proposal",
          "accept",
          "--proposal-id",
          proposalId,
          "--note",
          "approved_from_beta4_gate",
        ],
        traceProposalAccept,
      );
      if (traceProposalAccept.status !== 0) {
        failures.push(
          `director trace-proposal accept exit status expected 0 but received ${traceProposalAccept.status}.`,
        );
      }
      verifyNeedles(
        traceProposalAccept.stdout,
        "director trace-proposal accept",
        benchmarkCase.expected.traceProposalAcceptNeedles,
        failures,
      );

      const traceProposalExplain = runHotflowCli(
        repoRoot,
        ["director", "trace-proposal", "explain", "--proposal-id", proposalId],
        cliEnv,
      );
      recordCommandRun(
        commandRuns,
        "director-trace-proposal-explain",
        ["director", "trace-proposal", "explain", "--proposal-id", proposalId],
        traceProposalExplain,
      );
      if (traceProposalExplain.status !== 0) {
        failures.push(
          `director trace-proposal explain exit status expected 0 but received ${traceProposalExplain.status}.`,
        );
      }
      verifyNeedles(
        traceProposalExplain.stdout,
        "director trace-proposal explain",
        benchmarkCase.expected.traceProposalExplainNeedles,
        failures,
      );
      verifyNeedles(
        traceProposalExplain.stdout,
        "director trace-proposal explain after accept",
        benchmarkCase.expected.traceProposalAcceptedExplainNeedles,
        failures,
      );

      const traceProposalPreview = runHotflowCli(
        repoRoot,
        ["director", "trace-proposal", "preview", "--proposal-id", proposalId],
        cliEnv,
      );
      recordCommandRun(
        commandRuns,
        "director-trace-proposal-preview",
        ["director", "trace-proposal", "preview", "--proposal-id", proposalId],
        traceProposalPreview,
      );
      if (traceProposalPreview.status !== 0) {
        failures.push(
          `director trace-proposal preview exit status expected 0 but received ${traceProposalPreview.status}.`,
        );
      }
      verifyNeedles(
        traceProposalPreview.stdout,
        "director trace-proposal preview",
        benchmarkCase.expected.traceProposalPreviewNeedles,
        failures,
      );

      const traceProposalReplay = runHotflowCli(
        repoRoot,
        [
          "director",
          "trace-proposal",
          "replay",
          "--proposal-id",
          proposalId,
          "--worker-id",
          "bench-beta4-replay",
        ],
        cliEnv,
      );
      recordCommandRun(
        commandRuns,
        "director-trace-proposal-replay",
        [
          "director",
          "trace-proposal",
          "replay",
          "--proposal-id",
          proposalId,
          "--worker-id",
          "bench-beta4-replay",
        ],
        traceProposalReplay,
      );
      if (traceProposalReplay.status !== 0) {
        failures.push(
          `director trace-proposal replay exit status expected 0 but received ${traceProposalReplay.status}.`,
        );
      }
      verifyNeedles(
        traceProposalReplay.stdout,
        "director trace-proposal replay",
        benchmarkCase.expected.traceProposalReplayNeedles,
        failures,
      );

      if (proposalAuditPath !== null) {
        assertFileExists(proposalAuditPath, "proposal audit log", failures);
      }
      if (proposalAuditPath !== null && existsSync(proposalAuditPath)) {
        const proposalAudit = readFileSync(proposalAuditPath, "utf8");
        verifyNeedles(
          proposalAudit,
          "director trace proposal audit",
          ['"action":"decision"', '"action":"previewed"', '"action":"replayed"'],
          failures,
        );
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
        recordPath,
        ingestPath,
        proposalIndexPath,
        proposalPath,
        ...(proposalAuditPath === null ? {} : { proposalAuditPath }),
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
        error instanceof Error ? error.message : String(error),
        ...(hostApi ? [preview(hostApi.getLogs().stderr)] : []),
      ],
      evidence: {
        runId: runIdValue,
      },
      commandRuns,
    };
  } finally {
    await hostApi?.close();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

for (const packageName of [
  "@hotflow/director-proposals",
  "@hotflow/director-execution",
  "@hotflow/director-worker",
]) {
  const buildResult = spawnSync(pnpmBin, ["--filter", packageName, "build"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (buildResult.status !== 0) {
    fail(
      `Failed to build ${packageName} before Director Beta-4 trace-to-proposal gate.`,
      `${buildResult.stderr}\n${buildResult.stdout}`,
    );
  }
}

mkdirSync(resultsDir, { recursive: true });

const caseResults = [];
for (const benchmarkCase of fixture.cases) {
  caseResults.push(await runCase(benchmarkCase));
}

const report = {
  suiteId: fixture.suiteId,
  fixturePath,
  generatedAt: new Date().toISOString(),
  caseResults,
};

const latestPath = resolve(resultsDir, "director-beta4-trace-to-proposal-gate-latest.json");
writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const failedCases = caseResults.filter((result) => result.status !== "passed");
if (failedCases.length > 0) {
  fail(
    `Director Beta-4 trace-to-proposal gate failed. Report: ${latestPath}`,
    failedCases
      .map((result) =>
        [`- ${result.id}`, ...result.failures.map((failure) => `  - ${failure}`)].join("\n"),
      )
      .join("\n"),
  );
}

process.stdout.write(`Director Beta-4 trace-to-proposal gate passed. Report: ${latestPath}\n`);
