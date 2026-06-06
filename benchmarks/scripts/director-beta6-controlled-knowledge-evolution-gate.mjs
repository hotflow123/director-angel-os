import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  getBenchmarksPaths,
  runHotflowCliCommand,
  runHotflowCliWithBuiltWorker,
} from "./cli-command.mjs";

const pnpmBin = process.env.npm_execpath ?? (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const { benchmarksDir, repoRoot, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(
  benchmarksDir,
  "fixtures",
  "director-beta6-controlled-knowledge-evolution-gate.json",
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

function runHotflowCli(command, env) {
  return {
    ...runHotflowCliCommand(command, env),
    error: null,
  };
}

function recordCommandRun(commandRuns, action, command, result) {
  commandRuns.push({
    action,
    command,
    status: result.status,
    durationMs: result.durationMs,
    stdoutPreview: preview(result.stdout),
    stderrPreview: preview(result.stderr),
    error: result.error ?? null,
  });
}

function verifyNeedles(output, label, needles, failures) {
  for (const needle of needles ?? []) {
    if (!output.includes(needle)) {
      failures.push(`${label} should include "${needle}".`);
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

async function startDirectorHostApi(workspaceEnv) {
  const host = "127.0.0.1";
  const port = await reservePort(host);
  const baseUrl = `http://${host}:${port}`;
  const stdoutChunks = [];
  const stderrChunks = [];

  const child = spawn(pnpmBin, ["--filter", "@hotflow/director-host-api", "dev"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...workspaceEnv,
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

function writeDirectorSwitchState(path, features) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        schemaId: "director.switches.v1",
        features,
      },
      null,
      2,
    ),
  );
}

function appendKnowledgeEvolutionObservation(input) {
  mkdirSync(dirname(input.observationPath), { recursive: true });
  const recordedAt = new Date(Date.now() - 1).toISOString();
  const anchorIds = [
    ...new Set([...(input.snapshot.group.anchorIds ?? []), "anchor-beta6-b"]),
  ].sort((left, right) => left.localeCompare(right));
  const observation = {
    schemaId: "director.observation.v1",
    observationId: `observation-evaluation-${input.snapshot.snapshotId}-beta6-update`,
    recordedAt,
    source: "evaluation",
    snapshotId: input.blueprint.snapshotId,
    runtimeId: input.blueprint.runtimeId,
    blueprintId: input.blueprint.blueprintId,
    handoffId: input.blueprint.handoff.handoffId,
    workingContext: {
      snapshotId: input.snapshot.snapshotId,
      runtimeId: input.snapshot.runtime.runtimeId,
      operatorId: null,
      goal:
        input.snapshot.project.outline ??
        input.snapshot.project.title ??
        input.blueprint.actionGraph.goal,
      projectLabel: input.snapshot.project.outline ?? input.snapshot.project.title,
      projectId: input.snapshot.project.projectId,
      groupId: input.snapshot.group.groupId,
      generationType: input.snapshot.group.generationType,
      ...(input.snapshot.group.generationStyle === undefined
        ? {}
        : { generationStyle: input.snapshot.group.generationStyle }),
      sceneCount: input.snapshot.group.sceneCount,
      anchorIds,
    },
    recallHints: {
      preferredBindings: [
        ...new Set(
          [
            input.snapshot.intent.preferredImageBinding,
            input.snapshot.intent.preferredVideoBinding,
          ].filter((binding) => typeof binding === "string" && binding.length > 0),
        ),
      ],
      requiredBindings: [
        ...new Set(
          [
            input.snapshot.intent.requiredImageBinding,
            input.snapshot.intent.requiredVideoBinding,
          ].filter((binding) => typeof binding === "string" && binding.length > 0),
        ),
      ],
      fallbackBindings: [...new Set(input.snapshot.intent.fallbackBindings ?? [])],
      continuityAnchorIds: anchorIds,
      knowledgeSignalTags: ["controlled-knowledge-evolution"],
      deliverables: [input.blueprint.actionGraph.goal],
    },
    notes: ["benchmark: second run carries a real review-gated knowledge update signal"],
  };

  appendFileSync(input.observationPath, `${JSON.stringify(observation)}\n`, "utf8");
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
    notes: ["Benchmark synthesized intake for Director Beta-6 knowledge gate."],
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
    notes: ["Benchmark synthesized alignment lock for Director Beta-6 knowledge gate."],
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

function extractRunId(stdout) {
  const match = stdout.match(/run id:\s*([^\n\r]+)/iu);
  return match?.[1]?.trim() ?? null;
}

function assertFileExists(path, label, failures) {
  if (!existsSync(path)) {
    failures.push(`${label} missing at ${path}.`);
  }
}

async function runCase(benchmarkCase) {
  const started = process.hrtime.bigint();
  const workspaceRoot = mkdtempSync(join(tmpdir(), `director-beta6-${benchmarkCase.id}-`));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", `${benchmarkCase.id}.sqlite`);
  const snapshotPath = join(workspaceRoot, "snapshot.json");
  const blueprintPath = join(workspaceRoot, "blueprint.json");
  const observationPath = join(workspaceRoot, ".director-angel", "runtime", "observations.ndjson");
  const switchesPath = join(workspaceRoot, ".director-angel", "runtime", "switches.json");
  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(snapshotPath, JSON.stringify(benchmarkCase.snapshot, null, 2));

  const switchFeatures = {
    "knowledgeRecall.enabled": true,
    "knowledgeEvolution.enabled": true,
    "knowledgeEvolution.autoCandidate": true,
    "knowledgeEvolution.publish": true,
  };
  writeDirectorSwitchState(switchesPath, switchFeatures);

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
  let packId = null;

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
        `/v1/blueprint failed (${blueprintResponse.response.status}): ${JSON.stringify(
          blueprintResponse.body,
        )}`,
      );
    }

    writeFileSync(
      blueprintPath,
      JSON.stringify(normalizeBlueprintForPreviewExecution(blueprintResponse.body), null, 2),
    );

    const runIds = [];

    for (let runIndex = 1; runIndex <= 2; runIndex += 1) {
      const runOrdinal = runIndex === 1 ? "first" : "second";
      if (runIndex === 2) {
        appendKnowledgeEvolutionObservation({
          observationPath,
          snapshot: benchmarkCase.snapshot,
          blueprint: blueprintResponse.body,
        });
      }
      const createRun = runHotflowCli(
        ["director", "run", "create", "--input", blueprintPath, "--host", hostApi.baseUrl],
        cliEnv,
      );
      recordCommandRun(
        commandRuns,
        `director-run-create-${runOrdinal}`,
        ["director", "run", "create", "--input", blueprintPath, "--host", hostApi.baseUrl],
        createRun,
      );
      if (createRun.status !== 0) {
        failures.push(
          `director run create (run ${runIndex}) exit status expected 0 but received ${createRun.status}.`,
        );
        if (createRun.error) {
          failures.push(`director run create error: ${createRun.error}`);
        }
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
        break;
      }
      runIds.push(runId);

      const startRun = runHotflowCli(
        ["director", "run", "start", "--run-id", runId, "--host", hostApi.baseUrl],
        cliEnv,
      );
      recordCommandRun(
        commandRuns,
        `director-run-start-${runOrdinal}`,
        ["director", "run", "start", "--run-id", runId, "--host", hostApi.baseUrl],
        startRun,
      );
      if (startRun.status !== 0) {
        failures.push(
          `director run start (run ${runIndex}) exit status expected 0 but received ${startRun.status}.`,
        );
      }
      verifyNeedles(
        startRun.stdout,
        "director run start",
        ["Director run:", "status: running"],
        failures,
      );

      for (let attempt = 1; attempt <= 6; attempt += 1) {
        const workerRun = await runHotflowCliWithBuiltWorker(
          [
            "director",
            "run",
            "once",
            "--run-id",
            runId,
            "--worker-id",
            `bench-beta6-run-${runIndex}-${attempt}`,
          ],
          workerEnv,
        );
        recordCommandRun(
          commandRuns,
          `director-run-once-${runOrdinal}-${attempt}`,
          [
            "director",
            "run",
            "once",
            "--run-id",
            runId,
            "--worker-id",
            `bench-beta6-run-${runIndex}-${attempt}`,
          ],
          workerRun,
        );
        if (workerRun.status !== 0) {
          failures.push(
            `director run once (run ${runIndex}) exit status expected 0 but received ${workerRun.status}.`,
          );
        }
        if (workerRun.stdout.includes("status: completed")) {
          break;
        }
      }

      const proposalIndexPath = join(
        workspaceRoot,
        ".director-angel",
        "runtime",
        "proposals",
        "index.json",
      );
      assertFileExists(proposalIndexPath, `proposal index (run ${runIndex})`, failures);
      let proposalId = null;
      if (existsSync(proposalIndexPath)) {
        const index = JSON.parse(readFileSync(proposalIndexPath, "utf8"));
        proposalId = index.entries?.[0]?.proposalId ?? null;
        if (typeof proposalId !== "string") {
          failures.push(`Proposal index run ${runIndex} did not expose a proposalId.`);
        }
      }
      if (typeof proposalId !== "string") {
        throw new Error(
          `Director Beta-6 gate could not locate a proposalId after run ${runIndex}.`,
        );
      }

      const acceptProposal = runHotflowCli(
        [
          "director",
          "trace-proposal",
          "accept",
          "--proposal-id",
          proposalId,
          "--note",
          `beta6_gate_run${runIndex}_accept`,
        ],
        cliEnv,
      );
      recordCommandRun(
        commandRuns,
        `director-trace-proposal-accept-${runOrdinal}`,
        [
          "director",
          "trace-proposal",
          "accept",
          "--proposal-id",
          proposalId,
          "--note",
          `beta6_gate_run${runIndex}_accept`,
        ],
        acceptProposal,
      );
      if (acceptProposal.status !== 0) {
        failures.push(
          `director trace-proposal accept (run ${runIndex}) exit status expected 0 but received ${acceptProposal.status}.`,
        );
      }
      verifyNeedles(
        acceptProposal.stdout,
        "director trace-proposal accept",
        ["Director trace proposal decision:", "next status: accepted"],
        failures,
      );

      const candidateSync = runHotflowCli(
        [
          "director",
          "knowledge",
          "sync",
          "--proposal-id",
          proposalId,
          "--author",
          "benchmark-operator",
          "--note",
          `beta6_gate_sync_run${runIndex}`,
        ],
        cliEnv,
      );
      recordCommandRun(
        commandRuns,
        `director-knowledge-candidate-sync-${runOrdinal}`,
        [
          "director",
          "knowledge",
          "sync",
          "--proposal-id",
          proposalId,
          "--author",
          "benchmark-operator",
          "--note",
          `beta6_gate_sync_run${runIndex}`,
        ],
        candidateSync,
      );
      if (candidateSync.status !== 0) {
        failures.push(
          `director knowledge candidate sync (run ${runIndex}) exit status expected 0 but received ${candidateSync.status}.`,
        );
      }

      const packMatch = candidateSync.stdout.match(/pack id:\s*([^\n]+)/iu);
      if (!packMatch) {
        failures.push("Candidate sync output did not expose pack id.");
        throw new Error("Director Beta-6 gate could not determine knowledge pack id.");
      }
      packId = packMatch[1].trim();

      const syncNeedles =
        runIndex === 1
          ? benchmarkCase.expected.candidateSyncFirstNeedles
          : benchmarkCase.expected.candidateSyncSecondNeedles;
      verifyNeedles(
        candidateSync.stdout,
        "director knowledge candidate sync",
        syncNeedles,
        failures,
      );

      if (runIndex === 1) {
        const acceptFirstCandidate = runHotflowCli(
          [
            "director",
            "knowledge",
            "accept",
            "--pack-id",
            packId,
            "--author",
            "benchmark-operator",
            "--note",
            "beta6_gate_first_accept",
          ],
          cliEnv,
        );
        recordCommandRun(
          commandRuns,
          "director-knowledge-candidate-accept-first",
          [
            "director",
            "knowledge",
            "accept",
            "--pack-id",
            packId,
            "--author",
            "benchmark-operator",
            "--note",
            "beta6_gate_first_accept",
          ],
          acceptFirstCandidate,
        );
        if (acceptFirstCandidate.status !== 0) {
          failures.push("director knowledge candidate accept (v1) failed.");
        }
        verifyNeedles(
          acceptFirstCandidate.stdout,
          "director knowledge candidate accept (first)",
          benchmarkCase.expected.candidateAcceptNeedles,
          failures,
        );

        const publishFirst = runHotflowCli(
          [
            "director",
            "knowledge",
            "publish",
            "--pack-id",
            packId,
            "--author",
            "benchmark-operator",
            "--note",
            "beta6_gate_first_publish",
          ],
          cliEnv,
        );
        recordCommandRun(
          commandRuns,
          "director-knowledge-publish-first",
          [
            "director",
            "knowledge",
            "publish",
            "--pack-id",
            packId,
            "--author",
            "benchmark-operator",
            "--note",
            "beta6_gate_first_publish",
          ],
          publishFirst,
        );
        if (publishFirst.status !== 0) {
          failures.push("Director knowledge publish (v1) failed.");
        }
        verifyNeedles(
          publishFirst.stdout,
          "director knowledge publish (first)",
          benchmarkCase.expected.candidatePublishFirstNeedles,
          failures,
        );
      } else {
        const candidateList = runHotflowCli(["director", "knowledge", "candidate-list"], cliEnv);
        recordCommandRun(
          commandRuns,
          "director-knowledge-candidate-list",
          ["director", "knowledge", "candidate-list"],
          candidateList,
        );
        if (candidateList.status !== 0) {
          failures.push("director knowledge candidate-list failed.");
        }
        verifyNeedles(
          candidateList.stdout,
          "director knowledge candidate list",
          benchmarkCase.expected.candidateListNeedles,
          failures,
        );

        const candidateExplain = runHotflowCli(
          ["director", "knowledge", "candidate-explain", "--pack-id", packId],
          cliEnv,
        );
        recordCommandRun(
          commandRuns,
          "director-knowledge-candidate-explain",
          ["director", "knowledge", "candidate-explain", "--pack-id", packId],
          candidateExplain,
        );
        if (candidateExplain.status !== 0) {
          failures.push("director knowledge candidate-explain failed.");
        }
        verifyNeedles(
          candidateExplain.stdout,
          "director knowledge candidate explain",
          benchmarkCase.expected.candidateExplainNeedles,
          failures,
        );

        const candidateDiff = runHotflowCli(
          ["director", "knowledge", "diff", "--pack-id", packId],
          cliEnv,
        );
        recordCommandRun(
          commandRuns,
          "director-knowledge-candidate-diff",
          ["director", "knowledge", "diff", "--pack-id", packId],
          candidateDiff,
        );
        if (candidateDiff.status !== 0) {
          failures.push("director knowledge diff failed.");
        }
        verifyNeedles(
          candidateDiff.stdout,
          "director knowledge diff",
          benchmarkCase.expected.candidateDiffNeedles,
          failures,
        );

        const candidateReview = runHotflowCli(
          ["director", "knowledge", "review", "--pack-id", packId],
          cliEnv,
        );
        recordCommandRun(
          commandRuns,
          "director-knowledge-candidate-review",
          ["director", "knowledge", "review", "--pack-id", packId],
          candidateReview,
        );
        if (candidateReview.status !== 0) {
          failures.push("director knowledge candidate review failed.");
        }
        verifyNeedles(
          candidateReview.stdout,
          "director knowledge candidate review",
          benchmarkCase.expected.candidateReviewNeedles,
          failures,
        );

        const acceptCandidate = runHotflowCli(
          [
            "director",
            "knowledge",
            "accept",
            "--pack-id",
            packId,
            "--author",
            "benchmark-operator",
            "--note",
            "beta6_gate_second_accept",
          ],
          cliEnv,
        );
        recordCommandRun(
          commandRuns,
          "director-knowledge-candidate-accept",
          [
            "director",
            "knowledge",
            "accept",
            "--pack-id",
            packId,
            "--author",
            "benchmark-operator",
            "--note",
            "beta6_gate_second_accept",
          ],
          acceptCandidate,
        );
        if (acceptCandidate.status !== 0) {
          failures.push("director knowledge candidate accept failed.");
        }
        verifyNeedles(
          acceptCandidate.stdout,
          "director knowledge candidate accept",
          benchmarkCase.expected.candidateAcceptNeedles,
          failures,
        );

        const publishSecond = runHotflowCli(
          [
            "director",
            "knowledge",
            "publish",
            "--pack-id",
            packId,
            "--author",
            "benchmark-operator",
            "--note",
            "beta6_gate_second_publish",
          ],
          cliEnv,
        );
        recordCommandRun(
          commandRuns,
          "director-knowledge-publish-second",
          [
            "director",
            "knowledge",
            "publish",
            "--pack-id",
            packId,
            "--author",
            "benchmark-operator",
            "--note",
            "beta6_gate_second_publish",
          ],
          publishSecond,
        );
        if (publishSecond.status !== 0) {
          failures.push("director knowledge publish (v2) failed.");
        }
        verifyNeedles(
          publishSecond.stdout,
          "director knowledge publish (second)",
          benchmarkCase.expected.candidatePublishSecondNeedles,
          failures,
        );
      }
    }

    const recallArgs = [
      "director",
      "knowledge",
      "recall-preview",
      "--project-id",
      benchmarkCase.expected.recallQuery.projectId,
      "--group-id",
      benchmarkCase.expected.recallQuery.groupId,
      "--anchor-id",
      benchmarkCase.expected.recallQuery.anchorId,
    ];
    const recallPreview = runHotflowCli(recallArgs, cliEnv);
    recordCommandRun(commandRuns, "director-knowledge-recall-preview", recallArgs, recallPreview);
    if (recallPreview.status !== 0) {
      failures.push("director knowledge recall-preview failed.");
      if (recallPreview.error) {
        failures.push(`director knowledge recall-preview error: ${recallPreview.error}`);
      }
    }
    verifyNeedles(
      recallPreview.stdout,
      "director knowledge recall preview",
      benchmarkCase.expected.knowledgeRecallNeedles,
      failures,
    );

    const rollback = runHotflowCli(
      [
        "director",
        "knowledge",
        "rollback",
        "--pack-id",
        packId,
        "--version",
        "1",
        "--author",
        "benchmark-operator",
        "--note",
        "beta6_gate_rollback",
      ],
      cliEnv,
    );
    recordCommandRun(
      commandRuns,
      "director-knowledge-rollback",
      [
        "director",
        "knowledge",
        "rollback",
        "--pack-id",
        packId,
        "--version",
        "1",
        "--author",
        "benchmark-operator",
        "--note",
        "beta6_gate_rollback",
      ],
      rollback,
    );
    if (rollback.status !== 0) {
      failures.push("director knowledge rollback failed.");
      if (rollback.error) {
        failures.push(`director knowledge rollback error: ${rollback.error}`);
      }
    }
    verifyNeedles(
      rollback.stdout,
      "director knowledge rollback",
      benchmarkCase.expected.knowledgeRollbackNeedles,
      failures,
    );

    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    return {
      id: benchmarkCase.id,
      status: failures.length === 0 ? "passed" : "failed",
      durationMs: Number(durationMs.toFixed(2)),
      failures,
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
        ...(hostApi ? [`host api stderr: ${preview(hostApi.getLogs().stderr, 15)}`] : []),
      ],
      commandRuns,
    };
  } finally {
    await hostApi?.close();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

for (const packageName of [
  "@hotflow/director-proposals",
  "@hotflow/director-worker",
  "@hotflow/director-knowledge",
]) {
  const buildResult = spawnSync(pnpmBin, ["--filter", packageName, "build"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (buildResult.status !== 0) {
    fail(
      `Failed to build ${packageName} before Director Beta-6 knowledge evolution gate.`,
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

const latestPath = resolve(
  resultsDir,
  "director-beta6-controlled-knowledge-evolution-gate-latest.json",
);
writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const failedCases = caseResults.filter((result) => result.status !== "passed");
if (failedCases.length > 0) {
  fail(
    `Director Beta-6 controlled knowledge evolution gate failed. Report: ${latestPath}`,
    failedCases
      .map((result) =>
        [`- ${result.id}`, ...result.failures.map((failure) => `  - ${failure}`)].join("\n"),
      )
      .join("\n"),
  );
}

process.stdout.write(
  `Director Beta-6 controlled knowledge evolution gate passed. Report: ${latestPath}\n`,
);
