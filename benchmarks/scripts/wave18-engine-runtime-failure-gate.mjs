import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { DynamicContextAssembler } from "../../packages/context/dist/index.js";
import { PhaseOneEngine, isEngineRunFailure } from "../../packages/engine/dist/index.js";
import { ModelProviderError } from "../../packages/models/dist/index.js";
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

function createSessionStore() {
  const journalEntries = [];
  const runtimeEvidenceEntries = [];

  return {
    journalEntries,
    runtimeEvidenceEntries,
    sessionStore: {
      getSession() {
        return null;
      },
      createSession() {
        return {
          sessionId: "session-wave18",
          metadata: {},
          status: "active",
          schemaVersion: "sessions/v1",
          createdAtMs: 1,
          updatedAtMs: 1,
          archivedAtMs: null,
          archiveReason: null,
        };
      },
      recover() {
        return {
          session: {
            sessionId: "session-wave18",
            metadata: {},
            status: "active",
            schemaVersion: "sessions/v1",
            createdAtMs: 1,
            updatedAtMs: 1,
            archivedAtMs: null,
            archiveReason: null,
          },
          checkpoint: null,
          journal: [],
          state: {
            tasks: {
              items: [],
            },
          },
          lastAppliedSeq: 0,
        };
      },
      recoverStep() {
        return {
          session: {
            sessionId: "session-wave18",
            metadata: {},
            status: "active",
            schemaVersion: "sessions/v1",
            createdAtMs: 1,
            updatedAtMs: 1,
            archivedAtMs: null,
            archiveReason: null,
          },
          checkpoint: null,
          journal: [],
          state: {
            tasks: {
              items: [],
            },
          },
          lastAppliedSeq: 0,
          turnId: "turn-wave18",
          stepCheckpoint: null,
          stepJournal: [],
          replay: {
            modelOutput: [],
            plannedTools: [],
            toolResults: [],
            finalOutput: [],
          },
          replayWindow: {
            fromSeqExclusive: 0,
            toSeqInclusive: 0,
          },
          lastStepEvent: null,
          resumeAction: "no-progress",
          nextStepIndex: 0,
        };
      },
      appendJournal(_sessionId, input) {
        journalEntries.push(input);
      },
      createCheckpoint() {
        return null;
      },
      recordRuntimeEvidence(_sessionId, input) {
        runtimeEvidenceEntries.push(input);
      },
      appendStepJournal() {
        return null;
      },
      createStepCheckpoint() {
        return null;
      },
    },
  };
}

function createMemory() {
  return {
    writeLayer0() {
      return null;
    },
    recallWorkingMemory() {
      return {
        blockId: "working-memory",
        source: "working-memory",
        scope: { sessionId: "session-wave18" },
        items: [],
      };
    },
  };
}

async function runCase(benchmarkCase) {
  const { journalEntries, runtimeEvidenceEntries, sessionStore } = createSessionStore();
  const engine = new PhaseOneEngine({
    contextAssembler: new DynamicContextAssembler(),
    createDispatcher() {
      return {
        async dispatch() {
          throw new Error("dispatch should not be called in wave18");
        },
      };
    },
    memory: createMemory(),
    modelRuntime: {
      async generate() {
        throw new ModelProviderError({
          providerId: benchmarkCase.providerId,
          stage: "generate",
          code: benchmarkCase.providerCode,
          message: benchmarkCase.message,
          statusCode: benchmarkCase.statusCode,
          retryable: benchmarkCase.retryable,
        });
      },
    },
    sessionStore,
    workspaceRoot: "/workspace",
  });

  let thrown = null;
  try {
    await engine.runTurn({
      userText: benchmarkCase.userText,
      providerId: benchmarkCase.providerId,
      model: benchmarkCase.model,
      turnId: benchmarkCase.turnId,
      maxSteps: 1,
    });
  } catch (error) {
    thrown = error;
  }

  const actual = {
    errorName: thrown?.name ?? null,
    isEngineRunFailure: isEngineRunFailure(thrown),
    message: thrown?.message ?? null,
    failureCode: thrown?.failure?.error?.code ?? null,
    failureAction: thrown?.failure?.action ?? null,
    failureKind: thrown?.failure?.kind ?? null,
    providerId: thrown?.failure?.providerId ?? null,
    providerStage: thrown?.failure?.providerStage ?? null,
    providerCode: thrown?.failure?.providerCode ?? null,
    retryable: thrown?.failure?.retryable ?? null,
    statusCode: thrown?.failure?.statusCode ?? null,
    journal: journalEntries.find((entry) => entry.eventType === "runtime.failed")?.payload ?? null,
    evidence:
      runtimeEvidenceEntries.find((entry) => entry.kind === "runtime.failed")?.payload ?? null,
  };
  const failures = compareSubset(actual, benchmarkCase.expect, "result");

  return {
    caseId: benchmarkCase.id,
    durationMs: 0,
    ok: failures.length === 0,
    failures,
    actual,
  };
}

const { benchmarksDir, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave18-engine-runtime-failure-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const runs = [];

for (const benchmarkCase of fixture.cases ?? []) {
  runs.push(await runCase(benchmarkCase));
}

const failedRuns = runs.filter((run) => !run.ok);
mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave18-engine-runtime-failure-gate-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId: fixture.suiteId ?? "wave18-engine-runtime-failure-gate",
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
  `Wave 18 engine runtime failure gate completed: ${runs.length} runs, failed ${failedRuns.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (failedRuns.length > 0) {
  process.exitCode = 1;
}
