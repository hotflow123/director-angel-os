import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildTrajectoryDigestFromCommittedSnapshot } from "../../apps/worker-jobs/dist/learning/trajectory-digest.js";
import { stringifyCanonicalJson } from "../../packages/contracts/dist/index.js";
import { SessionStore } from "../../packages/sessions/dist/index.js";
import {
  projectSessionTaskState,
  readCommittedSessionTaskSnapshot,
} from "../../packages/tasks-core/dist/index.js";
import { getBenchmarksPaths } from "./cli-command.mjs";

function compareSubset(actual, expected, path = "value") {
  const failures = [];

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      failures.push(`Expected ${path} to be an array.`);
      return failures;
    }
    if (actual.length !== expected.length) {
      failures.push(`Expected ${path}.length=${expected.length} but received ${actual.length}.`);
      return failures;
    }
    for (const [index, expectedValue] of expected.entries()) {
      failures.push(...compareSubset(actual[index], expectedValue, `${path}[${index}]`));
    }
    return failures;
  }

  if (expected === null || typeof expected !== "object") {
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

function createWorkspace(prefix) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const dataDir = join(workspaceRoot, ".hotflow");
  mkdirSync(join(dataDir, "sessions"), { recursive: true });

  return {
    workspaceRoot,
    sessionDbPath: join(dataDir, "sessions", `${prefix}.sqlite`),
  };
}

function seedTurn(store, sessionId, turn) {
  if (!store.getSession(sessionId)) {
    store.createSession({ sessionId });
  }

  store.appendJournal(sessionId, {
    eventType: "user.input",
    turnId: turn.turnId,
    payload: { text: turn.userText },
    createdAtMs: turn.createdAtMsStart,
  });
  store.appendJournal(sessionId, {
    eventType: "tool.call_planned",
    turnId: turn.turnId,
    payload: {
      toolCallId: `call_${turn.turnId}`,
      toolName: turn.toolName,
      args: { path: "README.md" },
    },
    createdAtMs: turn.createdAtMsStart + 10,
  });
  store.appendJournal(sessionId, {
    eventType: "tool.result",
    turnId: turn.turnId,
    payload: {
      toolName: turn.toolName,
      ok: true,
      output: { text: `${turn.toolName} output` },
      error: null,
    },
    createdAtMs: turn.createdAtMsStart + 20,
  });
  store.appendJournal(sessionId, {
    eventType: "assistant.output",
    turnId: turn.turnId,
    payload: { text: turn.assistantText },
    createdAtMs: turn.createdAtMsStart + 30,
  });
  store.createCheckpoint(sessionId, {
    state: {
      lastTurnId: turn.turnId,
      lastAssistantOutput: turn.assistantText,
    },
    createdAtMs: turn.createdAtMsStart + 40,
  });
}

async function runCase(benchmarkCase) {
  const { workspaceRoot, sessionDbPath } = createWorkspace(`hotflow-wave25-${benchmarkCase.id}`);
  const store = new SessionStore({ dbPath: sessionDbPath });

  try {
    for (const turn of benchmarkCase.turns ?? []) {
      seedTurn(store, benchmarkCase.sessionId, turn);
    }

    const snapshot = readCommittedSessionTaskSnapshot(store, benchmarkCase.sessionId);
    const firstDigest = buildTrajectoryDigestFromCommittedSnapshot(snapshot, {
      fallbackTurnId: benchmarkCase.turnId,
    });
    const secondDigest = buildTrajectoryDigestFromCommittedSnapshot(
      readCommittedSessionTaskSnapshot(store, benchmarkCase.sessionId),
      {
        fallbackTurnId: benchmarkCase.turnId,
      },
    );
    const taskState = projectSessionTaskState(store, benchmarkCase.sessionId, {
      createIfMissing: false,
    });
    const journalTypes = store.journal
      .list(benchmarkCase.sessionId)
      .map((entry) => entry.eventType);

    const actual = {
      digestStable: stringifyCanonicalJson(firstDigest) === stringifyCanonicalJson(secondDigest),
      sourceSessionId: firstDigest.sourceSessionId,
      sourceTurnId: firstDigest.sourceTurnId,
      trajectoryRef: firstDigest.trajectoryRef,
      latestCommittedSeq: firstDigest.latestCommittedSeq,
      latestUserText: firstDigest.latestUserText,
      toolNames: firstDigest.toolNames,
      counts: firstDigest.counts,
      evidenceEventTypes: firstDigest.evidence.map((entry) => entry.eventType),
      evidenceSeqs: firstDigest.evidence.map((entry) => entry.seq),
      proposalQueueSize: taskState.proposalQueue.length,
      proposalOutboxSize: taskState.proposalOutbox.length,
      taskProposalJournalCount: journalTypes.filter(
        (eventType) => eventType === "tasks.proposal_enqueued",
      ).length,
    };

    const failures = compareSubset(actual, benchmarkCase.expect, "result");
    return {
      caseId: benchmarkCase.id,
      durationMs: 0,
      ok: failures.length === 0,
      failures,
      actual,
    };
  } catch (error) {
    return {
      caseId: benchmarkCase.id,
      durationMs: 0,
      ok: false,
      failures: [String(error)],
      actual: null,
    };
  } finally {
    store.close();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

const { benchmarksDir, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave25-learning-input-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const runs = [];

for (const benchmarkCase of fixture.cases ?? []) {
  runs.push(await runCase(benchmarkCase));
}

const failedRuns = runs.filter((run) => !run.ok);
mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave25-learning-input-gate-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId: fixture.suiteId ?? "wave25-learning-input-gate",
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
  `Wave 25 learning input gate completed: ${runs.length} runs, failed ${failedRuns.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (failedRuns.length > 0) {
  process.exitCode = 1;
}
