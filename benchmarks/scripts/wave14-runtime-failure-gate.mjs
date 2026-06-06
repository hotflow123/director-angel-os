import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createGatewayApp } from "../../apps/gateway/dist/server.js";
import { DynamicContextAssembler } from "../../packages/context/dist/index.js";
import { isContractError } from "../../packages/contracts/dist/index.js";
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

function normalizeHost(host) {
  return host === "::" ? "127.0.0.1" : host;
}

function createGatewayFetch(mode) {
  if (mode === "transient_429") {
    return async () =>
      new Response("rate limited", {
        status: 429,
        headers: {
          "content-type": "text/plain",
        },
      });
  }

  if (mode === "fatal_401") {
    return async () =>
      new Response("unauthorized", {
        status: 401,
        headers: {
          "content-type": "text/plain",
        },
      });
  }

  throw new Error(`Unsupported gateway benchmark mode: ${mode}`);
}

async function runGatewayCase(benchmarkCase) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), `hotflow-wave14-${benchmarkCase.id}-`));
  const dataDir = join(workspaceRoot, ".hotflow");
  const readmePath = join(workspaceRoot, "README.md");
  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(readmePath, "Runtime failure benchmark workspace.\n", "utf8");

  const app = createGatewayApp({
    env: {
      HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      HOTFLOW_DATA_DIR: dataDir,
      HOTFLOW_GATEWAY_SESSION_DB_PATH: join(dataDir, "sessions", `${benchmarkCase.id}.sqlite`),
      HOTFLOW_DEFAULT_PROVIDER: "openai-live",
      HOTFLOW_OPENAI_BASE_URL: "https://example.invalid/v1",
      HOTFLOW_OPENAI_PROVIDER_ID: "openai-live",
    },
    fetchImpl: createGatewayFetch(benchmarkCase.mode),
  });

  try {
    const started = await app.start({ host: "127.0.0.1", port: 0 });
    const startedAt = process.hrtime.bigint();
    const response = await fetch(
      `http://${normalizeHost(started.host)}:${started.port}/v1/channel/message`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channel: "webchat",
          agentId: "agent-main",
          peerId: "user_1",
          messageId: `msg_${benchmarkCase.id}`,
          receivedAtMs: Date.now(),
          text: `Read ${readmePath} and continue under runtime failure handling.`,
          routingHint: {
            agentId: "agent-main",
            channel: "webchat",
            routeKind: "direct",
            peerId: "user_1",
          },
        }),
      },
    );
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const body = await response.json();
    const failures = [];

    if (response.status !== benchmarkCase.expect.status) {
      failures.push(
        `Expected HTTP ${benchmarkCase.expect.status} but received ${response.status}.`,
      );
    }
    failures.push(...compareSubset(body, benchmarkCase.expect.jsonSubset, "body"));

    return {
      caseId: benchmarkCase.id,
      durationMs,
      ok: failures.length === 0,
      failures,
    };
  } finally {
    await app.close();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

function createEngineSessionStore() {
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
          sessionId: "session-wave14",
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
            sessionId: "session-wave14",
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
      appendJournal(_sessionId, input) {
        journalEntries.push(input);
      },
      createCheckpoint() {
        return null;
      },
      recordRuntimeEvidence(_sessionId, input) {
        runtimeEvidenceEntries.push(input);
      },
    },
  };
}

async function runEngineMemoryCase(benchmarkCase) {
  const { journalEntries, runtimeEvidenceEntries, sessionStore } = createEngineSessionStore();
  const engine = new PhaseOneEngine({
    contextAssembler: new DynamicContextAssembler(),
    createDispatcher() {
      return {
        async dispatch() {
          throw new Error("dispatch should not be called in engine memory benchmark");
        },
      };
    },
    memory: {
      writeLayer0() {
        return null;
      },
      recallWorkingMemory() {
        return {
          blockId: "working-memory",
          source: "working-memory",
          scope: { sessionId: "session-wave14" },
          items: [
            {
              id: "memory-hit-1",
              layer: "layer1",
              content: "A degraded recall item that may be omitted under budget pressure.",
              score: 0.72,
            },
          ],
          degraded: {
            reason: "memory-timeout",
            message: "external recall skipped",
          },
        };
      },
    },
    modelRuntime: {
      async generate() {
        return {
          text: "Memory degrade completed.",
        };
      },
    },
    sessionStore,
    workspaceRoot: "/workspace",
  });

  const startedAt = process.hrtime.bigint();
  const result = await engine.runTurn({
    userText: "Continue even if memory recall degrades.",
    providerId: "mock-provider",
    model: "mock-model",
    turnId: "turn-wave14-memory",
    maxSteps: 1,
    tokenBudget: 4,
  });
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const failures = [];

  if (result.output !== benchmarkCase.expect.output) {
    failures.push(
      `Expected output ${JSON.stringify(benchmarkCase.expect.output)} but received ${JSON.stringify(result.output)}.`,
    );
  }

  const runtimeDegradedJournal = journalEntries.find(
    (entry) => entry.eventType === "runtime.degraded",
  );
  const runtimeDegradedEvidence = runtimeEvidenceEntries.find(
    (entry) => entry.kind === "runtime.degraded",
  );

  if (!runtimeDegradedJournal) {
    failures.push("Expected engine journal to contain runtime.degraded.");
  } else {
    failures.push(
      ...compareSubset(
        runtimeDegradedJournal.payload,
        benchmarkCase.expect.journalSubset,
        "journal",
      ),
    );
  }

  if (!runtimeDegradedEvidence) {
    failures.push("Expected runtime evidence to contain runtime.degraded.");
  } else {
    failures.push(
      ...compareSubset(
        runtimeDegradedEvidence.payload,
        benchmarkCase.expect.evidenceSubset,
        "evidence",
      ),
    );
  }

  return {
    caseId: benchmarkCase.id,
    durationMs,
    ok: failures.length === 0,
    failures,
  };
}

function createProviderFailure(mode) {
  if (mode === "transient_429") {
    return new ModelProviderError({
      providerId: "openai-live",
      stage: "generate",
      code: "HTTP_429",
      message: "rate limited",
      statusCode: 429,
      retryable: true,
    });
  }

  if (mode === "fatal_401") {
    return new ModelProviderError({
      providerId: "openai-live",
      stage: "generate",
      code: "HTTP_401",
      message: "unauthorized",
      statusCode: 401,
      retryable: false,
    });
  }

  throw new Error(`Unsupported engine provider benchmark mode: ${mode}`);
}

async function runEngineProviderCase(benchmarkCase) {
  const { journalEntries, runtimeEvidenceEntries, sessionStore } = createEngineSessionStore();
  const engine = new PhaseOneEngine({
    contextAssembler: new DynamicContextAssembler(),
    createDispatcher() {
      return {
        async dispatch() {
          throw new Error("dispatch should not be called in engine provider benchmark");
        },
      };
    },
    memory: {
      writeLayer0() {
        return null;
      },
      recallWorkingMemory() {
        return {
          blockId: "working-memory",
          source: "working-memory",
          scope: { sessionId: "session-wave14" },
          items: [],
        };
      },
    },
    modelRuntime: {
      async generate() {
        throw createProviderFailure(benchmarkCase.mode);
      },
    },
    sessionStore,
    workspaceRoot: "/workspace",
  });

  const startedAt = process.hrtime.bigint();
  const failures = [];
  let thrownError = null;

  try {
    await engine.runTurn({
      userText: "Trigger provider failure inside engine.",
      providerId: "openai-live",
      model: "mock-model",
      turnId: benchmarkCase.turnId,
      maxSteps: 1,
    });
    failures.push("Expected engine.runTurn to throw.");
  } catch (error) {
    thrownError = error;
  }

  if (thrownError === null) {
    failures.push("Expected engine to throw.");
  } else if (isEngineRunFailure(thrownError)) {
    failures.push(
      ...compareSubset(
        {
          code: thrownError.failure.error.code,
          defaultAction: thrownError.failure.error.defaultAction,
          retryable: thrownError.failure.error.retryable,
          metadata: thrownError.failure.error.metadata ?? {},
        },
        benchmarkCase.expect.errorSubset,
        "error",
      ),
    );
  } else if (isContractError(thrownError)) {
    failures.push(
      ...compareSubset(
        {
          code: thrownError.code,
          defaultAction: thrownError.defaultAction,
          retryable: thrownError.retryable,
          metadata: thrownError.metadata ?? {},
        },
        benchmarkCase.expect.errorSubset,
        "error",
      ),
    );
  } else {
    failures.push("Expected engine to throw an EngineRunFailure or ContractError.");
  }

  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const runtimeFailedJournal = journalEntries.find((entry) => entry.eventType === "runtime.failed");
  const runtimeFailedEvidence = runtimeEvidenceEntries.find(
    (entry) => entry.kind === "runtime.failed",
  );

  if (!runtimeFailedJournal) {
    failures.push("Expected engine journal to contain runtime.failed.");
  } else {
    failures.push(
      ...compareSubset(runtimeFailedJournal.payload, benchmarkCase.expect.journalSubset, "journal"),
    );
  }

  if (!runtimeFailedEvidence) {
    failures.push("Expected runtime evidence to contain runtime.failed.");
  } else {
    failures.push(
      ...compareSubset(
        runtimeFailedEvidence.payload,
        benchmarkCase.expect.evidenceSubset,
        "evidence",
      ),
    );
  }

  return {
    caseId: benchmarkCase.id,
    durationMs,
    ok: failures.length === 0,
    failures,
  };
}

async function runCase(benchmarkCase) {
  if (benchmarkCase.type === "gateway") {
    return runGatewayCase(benchmarkCase);
  }
  if (benchmarkCase.type === "engine-provider") {
    return runEngineProviderCase(benchmarkCase);
  }
  if (benchmarkCase.type === "engine-memory") {
    return runEngineMemoryCase(benchmarkCase);
  }
  throw new Error(`Unsupported benchmark case type: ${benchmarkCase.type}`);
}

const { benchmarksDir, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave14-runtime-failure-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const runs = [];

for (const benchmarkCase of fixture.cases) {
  runs.push(await runCase(benchmarkCase));
}

const failedRuns = runs.filter((run) => !run.ok);
mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave14-runtime-failure-gate-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId: fixture.suiteId ?? "wave14-runtime-failure-gate",
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
  `Wave 14 runtime failure gate completed: ${runs.length} runs, failed ${failedRuns.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (failedRuns.length > 0) {
  process.exitCode = 1;
}
