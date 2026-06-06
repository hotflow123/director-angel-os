import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { DynamicContextAssembler } from "../../packages/context/dist/index.js";
import { PhaseOneEngine, isEngineRunFailure } from "../../packages/engine/dist/index.js";
import { ModelProviderError } from "../../packages/models/dist/index.js";
import { SessionStore } from "../../packages/sessions/dist/index.js";
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

function createMemory(sessionId) {
  return {
    writeLayer0() {
      return null;
    },
    recallWorkingMemory() {
      return {
        blockId: "working-memory",
        source: "working-memory",
        scope: { sessionId },
        items: [],
      };
    },
  };
}

function unwrapStepPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload ?? null;
  }
  if ("data" in payload) {
    return payload.data ?? null;
  }
  return payload;
}

function buildActualResult({ thrown, modelCalls, store, sessionId, turnId }) {
  const journal = store.journal.list(sessionId).filter((entry) => entry.turnId === turnId);
  const stepJournal = store.journal.listStep(sessionId, { turnId });
  const latestStep = store.recoverLatestStep(sessionId, { turnId });
  const stepRecovery = latestStep.stepRecovery;
  const evidence = store.listRuntimeEvidence(sessionId, { turnId });
  const contextBuiltEntry = journal.find((entry) => entry.eventType === "step.context_built");

  return {
    errorName: thrown?.name ?? null,
    isEngineRunFailure: isEngineRunFailure(thrown),
    message: thrown?.message ?? null,
    modelCalls,
    latestTurnId: latestStep.latestTurnId,
    resumeAction: stepRecovery?.resumeAction ?? null,
    nextStepIndex: stepRecovery?.nextStepIndex ?? null,
    stepCheckpointEventType: stepRecovery?.stepCheckpoint?.metadata?.eventType ?? null,
    stepJournalTypes: stepJournal.map((entry) => entry.eventType),
    journalTypes: journal.map((entry) => entry.eventType),
    evidenceKinds: evidence.map((entry) => entry.kind),
    contextBuilt:
      stepJournal.find((entry) => entry.eventType === "step.context_built")?.payload ??
      unwrapStepPayload(contextBuiltEntry?.payload ?? null),
    runtimeFailed: evidence.find((entry) => entry.kind === "runtime.failed")?.payload ?? null,
  };
}

async function runProviderFailureAnchorCase(benchmarkCase) {
  const { workspaceRoot, sessionDbPath } = createWorkspace(`hotflow-wave20-${benchmarkCase.id}`);
  const store = new SessionStore({ dbPath: sessionDbPath });
  let actual;

  try {
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher() {
        return {
          async dispatch() {
            throw new Error("dispatch should not run in pre-model anchor benchmark");
          },
        };
      },
      memory: createMemory(benchmarkCase.sessionId),
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
      sessionStore: store,
      workspaceRoot,
    });

    let thrown = null;
    try {
      await engine.runTurn({
        sessionId: benchmarkCase.sessionId,
        userText: benchmarkCase.userText,
        providerId: benchmarkCase.providerId,
        model: benchmarkCase.model,
        turnId: benchmarkCase.turnId,
        maxSteps: 1,
      });
    } catch (error) {
      thrown = error;
    }

    actual = buildActualResult({
      thrown,
      modelCalls: 1,
      store,
      sessionId: benchmarkCase.sessionId,
      turnId: benchmarkCase.turnId,
    });
  } finally {
    store.close();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }

  const {
    journalMustInclude = [],
    journalMustNotInclude = [],
    evidenceMustInclude = [],
    evidenceMustNotInclude = [],
    ...subsetExpectation
  } = benchmarkCase.expect;
  const failures = compareSubset(actual, subsetExpectation, "result");

  for (const eventType of journalMustInclude) {
    if (!actual.journalTypes.includes(eventType)) {
      failures.push(`Expected result.journalTypes to include ${eventType}.`);
    }
  }
  for (const eventType of journalMustNotInclude) {
    if (actual.journalTypes.includes(eventType)) {
      failures.push(`Expected result.journalTypes to omit ${eventType}.`);
    }
  }
  for (const kind of evidenceMustInclude) {
    if (!actual.evidenceKinds.includes(kind)) {
      failures.push(`Expected result.evidenceKinds to include ${kind}.`);
    }
  }
  for (const kind of evidenceMustNotInclude) {
    if (actual.evidenceKinds.includes(kind)) {
      failures.push(`Expected result.evidenceKinds to omit ${kind}.`);
    }
  }

  return {
    caseId: benchmarkCase.id,
    durationMs: 0,
    ok: failures.length === 0,
    failures,
    actual,
  };
}

async function runInternalCheckpointFailureCase(benchmarkCase) {
  const { workspaceRoot, sessionDbPath } = createWorkspace(`hotflow-wave20-${benchmarkCase.id}`);
  const store = new SessionStore({ dbPath: sessionDbPath });
  let actual;
  let modelCalls = 0;

  try {
    store.appendStepJournal = () => {
      throw new Error("step journal write failed");
    };

    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher() {
        return {
          async dispatch() {
            throw new Error("dispatch should not run in internal checkpoint failure benchmark");
          },
        };
      },
      memory: createMemory(benchmarkCase.sessionId),
      modelRuntime: {
        async generate() {
          modelCalls += 1;
          return {
            text: "unexpected model output",
          };
        },
      },
      sessionStore: store,
      workspaceRoot,
    });

    let thrown = null;
    try {
      await engine.runTurn({
        sessionId: benchmarkCase.sessionId,
        userText: benchmarkCase.userText,
        providerId: benchmarkCase.providerId,
        model: benchmarkCase.model,
        turnId: benchmarkCase.turnId,
        maxSteps: 1,
      });
    } catch (error) {
      thrown = error;
    }

    actual = buildActualResult({
      thrown,
      modelCalls,
      store,
      sessionId: benchmarkCase.sessionId,
      turnId: benchmarkCase.turnId,
    });
  } finally {
    store.close();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }

  const failures = compareSubset(actual, benchmarkCase.expect, "result");
  return {
    caseId: benchmarkCase.id,
    durationMs: 0,
    ok: failures.length === 0,
    failures,
    actual,
  };
}

async function runCase(benchmarkCase) {
  if (benchmarkCase.mode === "provider_failure_anchor") {
    return runProviderFailureAnchorCase(benchmarkCase);
  }
  if (benchmarkCase.mode === "internal_checkpoint_failure") {
    return runInternalCheckpointFailureCase(benchmarkCase);
  }
  throw new Error(`Unsupported wave20 mode: ${benchmarkCase.mode}`);
}

const { benchmarksDir, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave20-pre-model-boundary-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const runs = [];

for (const benchmarkCase of fixture.cases ?? []) {
  runs.push(await runCase(benchmarkCase));
}

const failedRuns = runs.filter((run) => !run.ok);
mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave20-pre-model-boundary-gate-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId: fixture.suiteId ?? "wave20-pre-model-boundary-gate",
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
  `Wave 20 pre-model boundary gate completed: ${runs.length} runs, failed ${failedRuns.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (failedRuns.length > 0) {
  process.exitCode = 1;
}
