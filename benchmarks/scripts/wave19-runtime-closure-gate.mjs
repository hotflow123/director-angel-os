import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createGatewayApp } from "../../apps/gateway/dist/server.js";
import { DynamicContextAssembler } from "../../packages/context/dist/index.js";
import { createRuntimeDegradeSurface } from "../../packages/contracts/dist/index.js";
import { PhaseOneEngine } from "../../packages/engine/dist/index.js";
import { MemoryCoreManager } from "../../packages/memory-core/dist/index.js";
import { ModelProviderError } from "../../packages/models/dist/index.js";
import { SessionStore } from "../../packages/sessions/dist/index.js";
import { ToolDispatcher, ToolRegistry } from "../../packages/tools/dist/index.js";
import { getBenchmarksPaths, runCliCommand } from "./cli-command.mjs";

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

  throw new Error(`Unsupported gateway mode: ${mode}`);
}

class ThrowingRecallMemory extends MemoryCoreManager {
  recallWorkingMemory() {
    throw new Error("recall backend timeout");
  }
}

function createWorkspace(prefix) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const dataDir = join(workspaceRoot, ".hotflow");
  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  return {
    workspaceRoot,
    dataDir,
  };
}

function runCliStatus(sessionDbPath, sessionId) {
  const result = runCliCommand(["status", sessionId], { sessionDbPath });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const runtimeStatus = /Runtime status:\s*([a-z-]+)/iu.exec(output)?.[1] ?? null;
  return {
    ...result,
    output,
    runtimeStatus,
  };
}

function inspectPersistedSession(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const journal = store.journal.list(sessionId);
    const latestTurnId = store.getLatestTurnId(sessionId);
    const turnJournal = latestTurnId
      ? journal.filter((entry) => entry.turnId === latestTurnId)
      : journal;
    const evidence = store.listRuntimeEvidence(
      sessionId,
      latestTurnId ? { turnId: latestTurnId } : {},
    );
    const recovery = store.recover(sessionId, { initialState: null });
    return {
      journal,
      turnJournal,
      evidence,
      latestTurnId,
      recovery,
    };
  } finally {
    store.close();
  }
}

async function runGatewayProviderFailureCase(benchmarkCase) {
  const { workspaceRoot, dataDir } = createWorkspace(`hotflow-wave19-${benchmarkCase.id}`);
  const sessionDbPath = join(dataDir, "sessions", `${benchmarkCase.id}.sqlite`);
  const app = createGatewayApp({
    env: {
      HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      HOTFLOW_DATA_DIR: dataDir,
      HOTFLOW_GATEWAY_SESSION_DB_PATH: sessionDbPath,
      HOTFLOW_DEFAULT_PROVIDER: "openai-live",
      HOTFLOW_OPENAI_BASE_URL: "https://example.invalid/v1",
      HOTFLOW_OPENAI_PROVIDER_ID: "openai-live",
    },
    fetchImpl: createGatewayFetch(benchmarkCase.mode),
    createMemory: () => new ThrowingRecallMemory(),
  });

  const failures = [];
  let durationMs = 0;

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
          text: "Trigger runtime closure provider failure.",
          routingHint: {
            agentId: "agent-main",
            channel: "webchat",
            routeKind: "direct",
            peerId: "user_1",
          },
        }),
      },
    );
    durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const bodyText = await response.text();
    let body;
    try {
      body = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
    } catch (error) {
      failures.push(`Response body is not valid JSON: ${String(error)}`);
    }

    if (response.status !== benchmarkCase.expect.response.status) {
      failures.push(
        `Expected HTTP ${benchmarkCase.expect.response.status} but received ${response.status}.`,
      );
    }
    failures.push(
      ...compareSubset(body, benchmarkCase.expect.response.jsonSubset, "response.body"),
    );
  } finally {
    await app.close();
  }

  try {
    const inspection = inspectPersistedSession(sessionDbPath, benchmarkCase.sessionId);
    const evidenceKinds = inspection.evidence.map((entry) => entry.kind);
    const journalEventTypes = inspection.turnJournal.map((entry) => entry.eventType);
    const degradeEvidence = inspection.evidence.find((entry) => entry.kind === "runtime.degraded");
    const failedEvidence = inspection.evidence.find((entry) => entry.kind === "runtime.failed");

    for (const kind of benchmarkCase.expect.evidenceKinds ?? []) {
      if (!evidenceKinds.includes(kind)) {
        failures.push(`Expected evidence kinds to include ${kind}.`);
      }
    }
    if (!inspection.latestTurnId) {
      failures.push("Expected session to have a latest turn id.");
    }
    if (!degradeEvidence) {
      failures.push("Expected runtime.degraded evidence to be persisted.");
    } else {
      failures.push(
        ...compareSubset(
          degradeEvidence.payload,
          benchmarkCase.expect.degradedEvidence,
          "degradedEvidence",
        ),
      );
    }
    if (!failedEvidence) {
      failures.push("Expected runtime.failed evidence to be persisted.");
    } else {
      failures.push(
        ...compareSubset(
          failedEvidence.payload,
          benchmarkCase.expect.failedEvidence,
          "failedEvidence",
        ),
      );
    }
    if (
      degradeEvidence &&
      failedEvidence &&
      (degradeEvidence.turnId === null ||
        failedEvidence.turnId === null ||
        degradeEvidence.turnId !== failedEvidence.turnId)
    ) {
      failures.push("Expected runtime.degraded and runtime.failed to reference the same turnId.");
    }

    for (const eventType of benchmarkCase.expect.journalMustInclude ?? []) {
      if (!journalEventTypes.includes(eventType)) {
        failures.push(`Expected journal to include ${eventType}.`);
      }
    }
    for (const eventType of benchmarkCase.expect.journalMustNotInclude ?? []) {
      if (journalEventTypes.includes(eventType)) {
        failures.push(`Expected journal to omit ${eventType}.`);
      }
    }

    const checkpointPresent = inspection.recovery.checkpoint !== null;
    if (checkpointPresent !== benchmarkCase.expect.checkpointPresent) {
      failures.push(
        `Expected checkpointPresent=${benchmarkCase.expect.checkpointPresent} but received ${checkpointPresent}.`,
      );
    }

    const statusResult = runCliStatus(sessionDbPath, benchmarkCase.sessionId);
    if (statusResult.status !== 0) {
      failures.push(`CLI status exited with ${statusResult.status}.`);
    }
    if (statusResult.runtimeStatus !== benchmarkCase.expect.cliRuntimeStatus) {
      failures.push(
        `Expected CLI runtime status ${benchmarkCase.expect.cliRuntimeStatus} but received ${String(statusResult.runtimeStatus)}.`,
      );
    }

    return {
      caseId: benchmarkCase.id,
      durationMs,
      ok: failures.length === 0,
      failures,
      details: {
        sessionId: benchmarkCase.sessionId,
        latestTurnId: inspection.latestTurnId,
        evidenceKinds,
        journalEventTypes,
        cliRuntimeStatus: statusResult.runtimeStatus,
      },
    };
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

async function runEngineToolClosureCase(benchmarkCase) {
  const { workspaceRoot, dataDir } = createWorkspace(`hotflow-wave19-${benchmarkCase.id}`);
  const sessionDbPath = join(dataDir, "sessions", `${benchmarkCase.id}.sqlite`);
  const sessionStore = new SessionStore({ dbPath: sessionDbPath });
  const failures = [];
  let durationMs = 0;
  let turnResult = null;

  const toolName =
    benchmarkCase.mode === "degraded" ? "bench.tool.degraded" : "bench.tool.throwing";
  const modelOutputs =
    benchmarkCase.mode === "degraded"
      ? [
          {
            text: "call degraded tool",
            toolCalls: [
              {
                id: "tool_call_1",
                name: toolName,
                argumentsJson: "{}",
              },
            ],
          },
          {
            text: "final after degrade",
          },
        ]
      : [
          {
            text: "call throwing tool",
            toolCalls: [
              {
                id: "tool_call_1",
                name: toolName,
                argumentsJson: "{}",
              },
            ],
          },
        ];

  const registry = new ToolRegistry();
  if (benchmarkCase.mode === "degraded") {
    registry.register({
      name: toolName,
      description: "Returns a degraded tool result for runtime closure benchmarking.",
      timeoutMs: 100,
      readOnly: true,
      async execute() {
        return {
          toolCallId: "tool_call_1",
          toolName,
          ok: false,
          error: "fallback response",
          resolution: "degraded",
          degradation: createRuntimeDegradeSurface({
            stage: "tool",
            category: "tool",
            severity: "minor",
            reason: "fallback",
            message: "fallback response",
            recoverable: true,
          }),
        };
      },
    });
  } else {
    registry.register({
      name: toolName,
      description: "Throws during tool execution for runtime closure benchmarking.",
      timeoutMs: 100,
      readOnly: true,
      async execute() {
        throw new Error("tool exploded");
      },
    });
  }

  const dispatcher = new ToolDispatcher(registry);
  const engine = new PhaseOneEngine({
    contextAssembler: new DynamicContextAssembler(),
    createDispatcher() {
      return dispatcher;
    },
    memory: new MemoryCoreManager(),
    modelRuntime: {
      async generate() {
        const output = modelOutputs.shift();
        if (!output) {
          throw new Error(`Missing scripted model output for ${benchmarkCase.id}.`);
        }
        return output;
      },
    },
    sessionStore,
    workspaceRoot,
  });

  try {
    const startedAt = process.hrtime.bigint();
    turnResult = await engine.runTurn({
      sessionId: benchmarkCase.sessionId,
      turnId: benchmarkCase.turnId,
      userText: `Run ${benchmarkCase.id}`,
      providerId: "bench-provider",
      model: "bench-model",
      maxSteps: benchmarkCase.mode === "degraded" ? 2 : 1,
    });
    durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  } catch (error) {
    failures.push(`Expected engine turn to complete, but it threw: ${String(error)}`);
  } finally {
    sessionStore.close();
  }

  try {
    if (
      turnResult &&
      benchmarkCase.expect.output !== undefined &&
      turnResult.output !== benchmarkCase.expect.output
    ) {
      failures.push(
        `Expected output ${JSON.stringify(benchmarkCase.expect.output)} but received ${JSON.stringify(turnResult.output)}.`,
      );
    }
    for (const needle of benchmarkCase.expect.outputIncludes ?? []) {
      if (!turnResult || !String(turnResult.output).includes(needle)) {
        failures.push(`Expected output to include ${JSON.stringify(needle)}.`);
      }
    }

    const inspection = inspectPersistedSession(sessionDbPath, benchmarkCase.sessionId);
    const evidenceKinds = inspection.evidence.map((entry) => entry.kind);
    const journalEventTypes = inspection.turnJournal.map((entry) => entry.eventType);
    const degradeEvidence = inspection.evidence.find((entry) => entry.kind === "runtime.degraded");
    const failedEvidence = inspection.evidence.find((entry) => entry.kind === "runtime.failed");

    for (const kind of benchmarkCase.expect.evidenceKinds ?? []) {
      if (!evidenceKinds.includes(kind)) {
        failures.push(`Expected evidence kinds to include ${kind}.`);
      }
    }
    if (benchmarkCase.expect.degradedEvidence) {
      if (!degradeEvidence) {
        failures.push("Expected runtime.degraded evidence to be persisted.");
      } else {
        failures.push(
          ...compareSubset(
            degradeEvidence.payload,
            benchmarkCase.expect.degradedEvidence,
            "degradedEvidence",
          ),
        );
      }
    }
    if (benchmarkCase.expect.failedEvidence) {
      if (!failedEvidence) {
        failures.push("Expected runtime.failed evidence to be persisted.");
      } else {
        failures.push(
          ...compareSubset(
            failedEvidence.payload,
            benchmarkCase.expect.failedEvidence,
            "failedEvidence",
          ),
        );
      }
    }

    for (const eventType of benchmarkCase.expect.journalMustInclude ?? []) {
      if (!journalEventTypes.includes(eventType)) {
        failures.push(`Expected journal to include ${eventType}.`);
      }
    }
    for (const eventType of benchmarkCase.expect.journalMustNotInclude ?? []) {
      if (journalEventTypes.includes(eventType)) {
        failures.push(`Expected journal to omit ${eventType}.`);
      }
    }

    const checkpointPresent = inspection.recovery.checkpoint !== null;
    if (checkpointPresent !== benchmarkCase.expect.checkpointPresent) {
      failures.push(
        `Expected checkpointPresent=${benchmarkCase.expect.checkpointPresent} but received ${checkpointPresent}.`,
      );
    }

    const statusResult = runCliStatus(sessionDbPath, benchmarkCase.sessionId);
    if (statusResult.status !== 0) {
      failures.push(`CLI status exited with ${statusResult.status}.`);
    }
    if (statusResult.runtimeStatus !== benchmarkCase.expect.cliRuntimeStatus) {
      failures.push(
        `Expected CLI runtime status ${benchmarkCase.expect.cliRuntimeStatus} but received ${String(statusResult.runtimeStatus)}.`,
      );
    }

    return {
      caseId: benchmarkCase.id,
      durationMs,
      ok: failures.length === 0,
      failures,
      details: {
        sessionId: benchmarkCase.sessionId,
        latestTurnId: inspection.latestTurnId,
        evidenceKinds,
        journalEventTypes,
        cliRuntimeStatus: statusResult.runtimeStatus,
      },
    };
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

const { benchmarksDir, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave19-runtime-closure-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const runs = [];

for (const benchmarkCase of fixture.cases) {
  if (benchmarkCase.kind === "gateway-provider-failure") {
    runs.push(await runGatewayProviderFailureCase(benchmarkCase));
    continue;
  }
  if (benchmarkCase.kind === "engine-tool-closure") {
    runs.push(await runEngineToolClosureCase(benchmarkCase));
    continue;
  }

  runs.push({
    caseId: benchmarkCase.id,
    durationMs: 0,
    ok: false,
    failures: [`Unsupported benchmark case kind: ${benchmarkCase.kind}`],
  });
}

const failedRuns = runs.filter((run) => !run.ok);
mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave19-runtime-closure-gate-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId: fixture.suiteId ?? "wave19-runtime-closure-gate",
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
  `Wave 19 runtime closure gate completed: ${runs.length} runs, failed ${failedRuns.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (failedRuns.length > 0) {
  process.exitCode = 1;
}
