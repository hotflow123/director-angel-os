import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { bootstrapWorkerJobs } from "../../apps/worker-jobs/dist/bootstrap.js";
import {
  SkillSnapshotFileStore,
  resolveApprovedSkillSnapshotPath,
} from "../../packages/skills/dist/index.js";
import { projectSessionTaskState } from "../../packages/tasks-core/dist/index.js";
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
    dataDir,
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

function toConfidenceBucket(confidence) {
  if (typeof confidence !== "number") {
    return "missing";
  }
  if (confidence < 0.5) {
    return "low";
  }
  if (confidence < 0.8) {
    return "medium";
  }
  return "high";
}

async function runCase(benchmarkCase) {
  const { workspaceRoot, dataDir, sessionDbPath } = createWorkspace(
    `hotflow-wave26-${benchmarkCase.id}`,
  );
  const env = {
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_WORKER_SESSION_DB_PATH: sessionDbPath,
  };
  const runtime = bootstrapWorkerJobs({ env });

  try {
    if (
      benchmarkCase.ensureSession === true &&
      !runtime.sessionStore.getSession(benchmarkCase.sessionId)
    ) {
      runtime.sessionStore.createSession({ sessionId: benchmarkCase.sessionId });
    }

    for (const turn of benchmarkCase.turns ?? []) {
      seedTurn(runtime.sessionStore, benchmarkCase.sessionId, turn);
    }

    if (Array.isArray(benchmarkCase.approvedSkills) && benchmarkCase.approvedSkills.length > 0) {
      new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir }, env)).writeApproved(
        benchmarkCase.approvedSkills,
      );
    }

    const result = await runtime.jobs.trajectorySummary({
      sessionId: benchmarkCase.sessionId,
      fallbackTurnId: benchmarkCase.turnId,
      proposalId: benchmarkCase.proposalId,
      provenance: benchmarkCase.provenance ?? "bench-wave26",
    });
    const proposal = result.decodedProposal;
    const taskState = projectSessionTaskState(runtime.sessionStore, benchmarkCase.sessionId, {
      createIfMissing: false,
    });

    const actual = {
      proposalKind: result.proposal.kind,
      proposalStatus: result.proposal.status,
      riskLevel: proposal?.riskLevel ?? null,
      confidenceBucket: toConfidenceBucket(proposal?.confidence),
      hasTrigger: typeof proposal?.trigger === "string" && proposal.trigger.length > 0,
      hasEvidenceSummary:
        typeof proposal?.evidenceSummary === "string" && proposal.evidenceSummary.length > 0,
      hasDedupeKey: typeof proposal?.dedupeKey === "string" && proposal.dedupeKey.length > 0,
      duplicateRecommendation: proposal?.duplicateMatch?.recommendation ?? null,
      duplicateSkillId: proposal?.duplicateMatch?.skillId ?? null,
      explanationContainsLowEvidence:
        typeof proposal?.explanation === "string" && proposal.explanation.includes("low evidence"),
      explanationContainsDuplicateSkillId:
        typeof proposal?.explanation === "string" &&
        proposal.duplicateMatch !== undefined &&
        proposal.explanation.includes(proposal.duplicateMatch.skillId),
      proposalQueueSize: taskState.proposalQueue.length,
      proposalOutboxSize: taskState.proposalOutbox.length,
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
    runtime.close();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

const { benchmarksDir, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave26-proposal-generator-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const runs = [];

for (const benchmarkCase of fixture.cases ?? []) {
  runs.push(await runCase(benchmarkCase));
}

const failedRuns = runs.filter((run) => !run.ok);
mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave26-proposal-generator-gate-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId: fixture.suiteId ?? "wave26-proposal-generator-gate",
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
  `Wave 26 proposal generator gate completed: ${runs.length} runs, failed ${failedRuns.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (failedRuns.length > 0) {
  process.exitCode = 1;
}
