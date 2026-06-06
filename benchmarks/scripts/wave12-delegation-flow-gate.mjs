import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { bootstrapCli } from "../../apps/cli/dist/bootstrap.js";
import { runDelegationJob } from "../../apps/worker-jobs/dist/run-delegation.js";
import { runVerificationJob } from "../../apps/worker-jobs/dist/run-verification.js";
import { SessionStore } from "../../packages/sessions/dist/index.js";
import {
  SessionStoreTaskPlanePort,
  projectSessionTaskState,
  readSessionDelegationMailbox,
  readSessionVerificationMailbox,
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
  writeFileSync(readmePath, "Agent OS repository details for delegation benchmark.\n", "utf8");

  const env = {
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
    HOTFLOW_WORKER_SESSION_DB_PATH: sessionDbPath,
    HOTFLOW_DEFAULT_PROVIDER: "scripted",
    HOTFLOW_DEFAULT_MODEL: "hotflow-phase1",
  };

  const cli = bootstrapCli({ env });
  try {
    const prompt = replaceReadmePlaceholder(benchmarkCase.prompt, readmePath);
    const turnResult = await cli.engine.runTurn({
      userText: prompt,
      providerId: "scripted",
      model: "hotflow-phase1",
      turnId: benchmarkCase.turnId,
    });
    const taskId = turnResult.taskState.items[0]?.id;
    const taskPlane = new SessionStoreTaskPlanePort(cli.sessionStore, turnResult.sessionId, {
      createIfMissing: false,
    });
    await taskPlane.enqueueDelegation({
      id: benchmarkCase.delegationId,
      workerId: benchmarkCase.workerId,
      instruction: benchmarkCase.instruction,
      ...(taskId === undefined ? {} : { taskId }),
    });

    const mailboxBefore = readSessionDelegationMailbox(
      cli.sessionStore,
      turnResult.sessionId,
      { workerId: benchmarkCase.workerId, statuses: ["queued"] },
      { createIfMissing: false },
    ).length;
    cli.sessionStore.close();

    const started = process.hrtime.bigint();
    const delegationResult = await runDelegationJob({
      sessionId: turnResult.sessionId,
      workerId: benchmarkCase.workerId,
      delegationId: benchmarkCase.delegationId,
      verificationId: benchmarkCase.verificationId,
      verifierId: benchmarkCase.verifierId,
      requirement: benchmarkCase.requirement,
      env,
    });
    const verificationMailboxStore = new SessionStore({ dbPath: sessionDbPath });
    const verificationMailboxBefore = readSessionVerificationMailbox(
      verificationMailboxStore,
      turnResult.sessionId,
      {
        verifierId: benchmarkCase.verifierId,
        statuses: ["pending"],
      },
      { createIfMissing: false },
    ).length;
    verificationMailboxStore.close();
    const verificationResult = await runVerificationJob({
      sessionId: turnResult.sessionId,
      verifierId: benchmarkCase.verifierId,
      verificationId: benchmarkCase.verificationId,
      status: benchmarkCase.verificationStatus,
      verdictSummary: benchmarkCase.verdictSummary,
      env,
    });
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;

    const store = new SessionStore({ dbPath: sessionDbPath });
    try {
      const taskState = projectSessionTaskState(store, turnResult.sessionId, {
        createIfMissing: false,
      });
      const mailboxAfter = readSessionDelegationMailbox(
        store,
        turnResult.sessionId,
        { workerId: benchmarkCase.workerId, statuses: ["queued"] },
        { createIfMissing: false },
      ).length;
      const verificationMailboxAfter = readSessionVerificationMailbox(
        store,
        turnResult.sessionId,
        {
          verifierId: benchmarkCase.verifierId,
          statuses: ["pending"],
        },
        { createIfMissing: false },
      ).length;
      const delegation = taskState.delegation.find(
        (entry) => entry.id === benchmarkCase.delegationId,
      );
      const verification = taskState.verification.find(
        (entry) => entry.id === benchmarkCase.verificationId,
      );

      const actual = {
        sessionId: turnResult.sessionId,
        delegationStatus: delegation?.status ?? null,
        verificationStatus: verification?.status ?? null,
        mailboxBefore,
        mailboxAfter,
        verificationMailboxBefore,
        verificationMailboxAfter,
        verifierId: verification?.verifierId ?? null,
        taskIdMatched:
          delegation?.taskId !== undefined &&
          verification?.taskId !== undefined &&
          delegation.taskId === verification.taskId,
        runDelegationStatus: delegationResult.status,
        runVerificationStatus: verificationResult.status,
        runDelegationJournalDelta: delegationResult.journalDelta,
        runVerificationJournalDelta: verificationResult.journalDelta,
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
      store.close();
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
    cli.close?.();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

const { benchmarksDir, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave12-delegation-flow-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const runs = [];

for (const benchmarkCase of fixture.cases ?? []) {
  runs.push(await runCase(benchmarkCase));
}

const failedRuns = runs.filter((run) => !run.ok);
mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave12-delegation-flow-gate-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId: fixture.suiteId ?? "wave12-delegation-flow-gate",
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
  `Wave 12 delegation flow gate completed: ${runs.length} runs, failed ${failedRuns.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (failedRuns.length > 0) {
  process.exitCode = 1;
}
