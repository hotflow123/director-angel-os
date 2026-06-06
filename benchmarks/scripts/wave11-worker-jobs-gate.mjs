import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { bootstrapCli } from "../../apps/cli/dist/bootstrap.js";
import { bootstrapWorkerJobs } from "../../apps/worker-jobs/dist/bootstrap.js";
import {
  SessionStoreTaskPlanePort,
  projectSessionTaskState,
} from "../../packages/tasks-core/dist/index.js";
import { getBenchmarksPaths } from "./cli-command.mjs";

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

function replaceReadmePlaceholder(value, readmePath) {
  if (typeof value === "string") {
    return value.replaceAll("__README__", readmePath);
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceReadmePlaceholder(item, readmePath));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceReadmePlaceholder(item, readmePath)]),
    );
  }
  return value;
}

async function runCase(benchmarkCase) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), `hotflow-bench-${benchmarkCase.id}-`));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", `${benchmarkCase.id}.sqlite`);
  const readmePath = join(workspaceRoot, "README.md");
  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(readmePath, "Agent OS repository details for worker-jobs benchmark.\n", "utf8");

  const env = {
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
    HOTFLOW_WORKER_SESSION_DB_PATH: sessionDbPath,
    HOTFLOW_DEFAULT_PROVIDER: "scripted",
    HOTFLOW_DEFAULT_MODEL: "hotflow-phase1",
  };

  const cli = bootstrapCli({ env });
  let reloadedCli = null;
  try {
    const prompt = replaceReadmePlaceholder(benchmarkCase.prompt, readmePath);
    const turnResult = await cli.engine.runTurn({
      userText: prompt,
      providerId: "scripted",
      model: "hotflow-phase1",
      sessionId: benchmarkCase.sessionId,
      turnId: benchmarkCase.turnId,
    });

    const worker = bootstrapWorkerJobs({ env });
    try {
      const started = process.hrtime.bigint();
      const workerResult = await worker.jobs.trajectorySummary({
        sessionId: turnResult.sessionId,
        proposalId: benchmarkCase.proposalId,
        provenance: benchmarkCase.provenance,
      });
      const taskPlane = new SessionStoreTaskPlanePort(worker.sessionStore, turnResult.sessionId, {
        createIfMissing: false,
      });
      await taskPlane.transitionProposal({
        proposalId: workerResult.proposalId,
        status: "accepted",
      });
      const reconcileResult = await worker.jobs.reconcileSkillProposal({
        sessionId: turnResult.sessionId,
        proposalId: workerResult.proposalId,
      });
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      const taskState = projectSessionTaskState(worker.sessionStore, turnResult.sessionId, {
        createIfMissing: false,
      });
      const staleRuntimeApprovedSkillCount = cli.skillRepository.listApproved().length;
      reloadedCli = bootstrapCli({ env });
      const reloadedApprovedSkillCount = reloadedCli.skillRepository.listApproved().length;
      const proposalStatusAfterReconcile =
        taskState.proposalQueue.find((entry) => entry.id === workerResult.proposalId)?.status ??
        null;

      const actual = {
        sessionId: turnResult.sessionId,
        sourceTurnId: workerResult.sourceTurnId,
        proposalId: workerResult.proposalId,
        proposalKind: workerResult.proposal.kind,
        proposalStatusAfterReconcile,
        proposalQueueSize: taskState.proposalQueue.length,
        proposalOutboxSize: taskState.proposalOutbox.length,
        provenance: workerResult.proposal.provenance,
        toolCallCount: workerResult.metrics.toolCallCount,
        toolResultCount: workerResult.metrics.toolResultCount,
        assistantOutputCount: workerResult.metrics.assistantOutputCount,
        approvedSkillsVisibleBeforeReload: staleRuntimeApprovedSkillCount,
        approvedSkillsVisibleAfterReload: reloadedApprovedSkillCount,
        appliedSkillId: reconcileResult.appliedSkillId,
      };
      const failures = compareSubset(actual, benchmarkCase.expect, "result");

      return {
        caseId: benchmarkCase.id,
        durationMs,
        ok: failures.length === 0,
        failures,
        actual,
      };
    } finally {
      worker.close();
    }
  } catch (error) {
    return {
      caseId: benchmarkCase.id,
      durationMs: 0,
      ok: false,
      failures: [String(error)],
      actual: null,
    };
  } finally {
    reloadedCli?.sessionStore.close();
    cli.sessionStore.close();
    cli.close?.();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

const { benchmarksDir, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave11-worker-jobs-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const runs = [];

for (const benchmarkCase of fixture.cases ?? []) {
  runs.push(await runCase(benchmarkCase));
}

const failedRuns = runs.filter((run) => !run.ok);
mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave11-worker-jobs-gate-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId: fixture.suiteId ?? "wave11-worker-jobs-gate",
        timestamp: new Date().toISOString(),
        totalRuns: runs.length,
        failedRuns: failedRuns.length,
      },
      runs,
    },
    null,
    2,
  ),
);

process.stdout.write(
  `Wave 11 worker-jobs gate completed: ${runs.length} runs, failed ${failedRuns.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (failedRuns.length > 0) {
  process.exitCode = 1;
}
