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

function buildActualResult({ thrown, result, store, sessionId, turnId }) {
  const journal = store.journal.list(sessionId).filter((entry) => entry.turnId === turnId);
  const streamEvents = store.listStreamEvents(sessionId, { turnId });
  const recovery = store.recover(sessionId, { initialState: null });

  return {
    errorName: thrown?.name ?? null,
    isEngineRunFailure: isEngineRunFailure(thrown),
    message: thrown?.message ?? null,
    assistantOutput: result?.output ?? null,
    journalTypes: journal.map((entry) => entry.eventType),
    streamKinds: streamEvents.map((entry) => entry.event.kind),
    streamStartedCount: streamEvents.filter((entry) => entry.event.kind === "stream.started")
      .length,
    latestStreamKind: streamEvents.at(-1)?.event.kind ?? null,
    streamChunkIndices: streamEvents
      .filter((entry) => entry.event.kind === "stream.chunk")
      .map((entry) => entry.event.payload.index),
    checkpointPresent: recovery.checkpoint !== null,
  };
}

async function runToolBoundaryRoundtripCase(benchmarkCase) {
  const { workspaceRoot, sessionDbPath } = createWorkspace(`hotflow-wave21-${benchmarkCase.id}`);
  const store = new SessionStore({ dbPath: sessionDbPath });
  let actual;

  try {
    const modelOutputs = [
      {
        text: "calling tool",
        toolCalls: [
          {
            id: "call-1",
            name: "demo_tool",
            argumentsJson: '{"topic":"todo"}',
          },
        ],
      },
      {
        text: "final answer",
      },
    ];
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher() {
        return {
          async dispatch() {
            return {
              toolCallId: "call-1",
              toolName: "demo_tool",
              ok: true,
              output: { ok: true },
              resolution: "executed",
            };
          },
        };
      },
      memory: createMemory(benchmarkCase.sessionId),
      modelRuntime: {
        async generate() {
          const output = modelOutputs.shift();
          if (!output) {
            throw new Error("missing model output");
          }
          return output;
        },
      },
      sessionStore: store,
      workspaceRoot,
    });

    const result = await engine.runTurn({
      sessionId: benchmarkCase.sessionId,
      userText: benchmarkCase.userText,
      providerId: benchmarkCase.providerId,
      model: benchmarkCase.model,
      turnId: benchmarkCase.turnId,
      maxSteps: 4,
    });

    actual = buildActualResult({
      thrown: null,
      result,
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

async function runProviderFailureStreamClosureCase(benchmarkCase) {
  const { workspaceRoot, sessionDbPath } = createWorkspace(`hotflow-wave21-${benchmarkCase.id}`);
  const store = new SessionStore({ dbPath: sessionDbPath });
  let actual;

  try {
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher() {
        return {
          async dispatch() {
            throw new Error("dispatch should not run in provider failure benchmark");
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
    let result = null;
    try {
      result = await engine.runTurn({
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
      result,
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

async function runResumeStreamContinuationCase(benchmarkCase) {
  const { workspaceRoot, sessionDbPath } = createWorkspace(`hotflow-wave21-${benchmarkCase.id}`);
  const store = new SessionStore({ dbPath: sessionDbPath });
  let actual;

  try {
    const session = store.createSession({ sessionId: benchmarkCase.sessionId });
    store.appendStepJournal(session.sessionId, {
      turnId: benchmarkCase.turnId,
      stepIndex: 0,
      eventType: "step.model_output",
      payload: { text: "partial output" },
    });
    store.appendStepJournal(session.sessionId, {
      turnId: benchmarkCase.turnId,
      stepIndex: 0,
      eventType: "step.tool_result",
      payload: {
        toolCallId: "call-1",
        toolName: "demo_tool",
        ok: true,
      },
    });
    store.appendStreamEvent(session.sessionId, {
      turnId: benchmarkCase.turnId,
      event: {
        id: "stream_started_0",
        kind: "stream.started",
        schemaVersion: "0.1.0",
        occurredAtMs: 1,
        payload: {
          turnId: benchmarkCase.turnId,
        },
      },
      createdAtMs: 1,
    });
    store.appendStreamEvent(session.sessionId, {
      turnId: benchmarkCase.turnId,
      event: {
        id: "stream_chunk_1",
        kind: "stream.chunk",
        schemaVersion: "0.1.0",
        occurredAtMs: 2,
        payload: {
          turnId: benchmarkCase.turnId,
          index: 0,
          delta: "partial output",
        },
      },
      createdAtMs: 2,
    });
    store.appendStreamEvent(session.sessionId, {
      turnId: benchmarkCase.turnId,
      event: {
        id: "stream_interrupted_2",
        kind: "stream.interrupted",
        schemaVersion: "0.1.0",
        occurredAtMs: 3,
        payload: {
          turnId: benchmarkCase.turnId,
          reason: "tool_boundary",
          resumable: true,
        },
      },
      createdAtMs: 3,
    });

    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher() {
        return {
          async dispatch() {
            throw new Error("dispatch should not run when resuming to a final answer");
          },
        };
      },
      memory: createMemory(benchmarkCase.sessionId),
      modelRuntime: {
        async generate() {
          return {
            text: "final after resume",
          };
        },
      },
      sessionStore: store,
      workspaceRoot,
    });

    const result = await engine.runTurn({
      sessionId: benchmarkCase.sessionId,
      userText: benchmarkCase.userText,
      providerId: benchmarkCase.providerId,
      model: benchmarkCase.model,
      turnId: benchmarkCase.turnId,
      maxSteps: 4,
    });

    actual = buildActualResult({
      thrown: null,
      result,
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
  if (benchmarkCase.mode === "tool_boundary_roundtrip") {
    return runToolBoundaryRoundtripCase(benchmarkCase);
  }
  if (benchmarkCase.mode === "provider_failure_stream_closure") {
    return runProviderFailureStreamClosureCase(benchmarkCase);
  }
  if (benchmarkCase.mode === "resume_stream_continuation") {
    return runResumeStreamContinuationCase(benchmarkCase);
  }
  throw new Error(`Unsupported wave21 mode: ${benchmarkCase.mode}`);
}

const { benchmarksDir, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave21-streaming-boundary-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const runs = [];

for (const benchmarkCase of fixture.cases ?? []) {
  runs.push(await runCase(benchmarkCase));
}

const failedRuns = runs.filter((run) => !run.ok);
mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave21-streaming-boundary-gate-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId: fixture.suiteId ?? "wave21-streaming-boundary-gate",
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
  `Wave 21 streaming boundary gate completed: ${runs.length} runs, failed ${failedRuns.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (failedRuns.length > 0) {
  process.exitCode = 1;
}
