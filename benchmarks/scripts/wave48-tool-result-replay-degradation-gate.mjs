import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DynamicContextAssembler } from "../../packages/context/dist/index.js";
import { PhaseOneEngine } from "../../packages/engine/dist/index.js";
import { SessionStore } from "../../packages/sessions/dist/index.js";
import { getBenchmarksPaths, runWorkspaceBuild } from "./cli-command.mjs";

function fail(message, details) {
  if (details) {
    process.stderr.write(`${message}\n${details}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

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

async function captureReplayDegradationRun() {
  const { workspaceRoot, sessionDbPath } = createWorkspace("hotflow-wave48");
  const store = new SessionStore({ dbPath: sessionDbPath });
  const capturedRequests = [];
  const modelOutputs = [
    {
      text: "I need to inspect the large file first.",
      toolCalls: [
        {
          id: "call-1",
          name: "filesystem.read_text",
          argumentsJson: '{"path":"README.md"}',
        },
      ],
    },
    {
      text: "I need one more tool after the replay trim.",
      toolCalls: [
        {
          id: "call-2",
          name: "tasks.todo_write",
          argumentsJson: '{"items":[{"id":"wave48","content":"follow up","status":"todo"}]}',
        },
      ],
    },
    {
      text: "final answer",
    },
  ];

  try {
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher() {
        return {
          async dispatch(call) {
            if (call.name === "filesystem.read_text") {
              return {
                toolCallId: "call-1",
                toolName: "filesystem.read_text",
                ok: true,
                output: {
                  blob: "A".repeat(3_000),
                },
                resolution: "executed",
              };
            }

            return {
              toolCallId: "call-2",
              toolName: "tasks.todo_write",
              ok: true,
              output: {
                items: [{ id: "wave48", content: "follow up", status: "todo" }],
              },
              resolution: "executed",
            };
          },
        };
      },
      memory: createMemory("session_wave48"),
      modelRuntime: {
        async generate({ request }) {
          capturedRequests.push(request);
          const next = modelOutputs.shift();
          if (!next) {
            throw new Error("missing model output in wave48 gate");
          }
          return next;
        },
      },
      sessionStore: store,
      workspaceRoot,
    });

    await engine.runTurn({
      sessionId: "session_wave48",
      turnId: "turn_wave48",
      userText: "Read the repository file and keep going after any replay trim.",
      providerId: "openai-compatible",
      model: "gpt-wave48",
      tokenBudget: 400,
      maxSteps: 3,
    });

    return {
      thirdRequest: capturedRequests[2],
      latestTurn: store.getSession("session_wave48")?.metadata?.runtime?.latestTurn ?? null,
      runtimeEvidence: store.listRuntimeEvidence("session_wave48", {
        kinds: ["runtime.degraded"],
        includeStream: false,
      }),
    };
  } finally {
    store.close();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

async function runGate() {
  const { resultsDir } = getBenchmarksPaths();

  for (const target of [
    "@hotflow/contracts",
    "@hotflow/policy-runtime",
    "@hotflow/tools",
    "@hotflow/context",
    "@hotflow/observability",
    "@hotflow/tasks-core",
    "@hotflow/models",
    "@hotflow/sessions",
    "@hotflow/engine",
  ]) {
    const build = runWorkspaceBuild(target, process.env);
    if (build.status !== 0) {
      fail(
        `build failed for ${target} during wave48 tool result replay degradation gate.`,
        build.stderr,
      );
    }
  }

  const failures = [];
  const { thirdRequest, latestTurn, runtimeEvidence } = await captureReplayDegradationRun();
  const userMessage = thirdRequest?.messages.find((message) => message.role === "user");
  const degradedEvidence = runtimeEvidence[0]?.payload ?? null;

  failures.push(
    ...compareSubset(
      latestTurn,
      {
        runtimeStatus: "degraded",
      },
      "latestTurn",
    ),
    ...compareSubset(
      degradedEvidence,
      {
        stage: "runtime",
        category: "runtime",
        action: "degrade",
        reason: "context-pressure",
        recoverable: true,
        metadata: {
          toolCallId: "call-1",
          toolName: "filesystem.read_text",
        },
      },
      "runtimeEvidence[0].payload",
    ),
  );

  if (typeof userMessage?.content !== "string") {
    failures.push("Expected thirdRequest user message content to be a string.");
  } else {
    for (const needle of [
      "## runtime.degradations",
      "reason=context-pressure",
      'Tool result replay for "filesystem.read_text" was truncated to fit the remaining context budget.',
    ]) {
      if (!userMessage.content.includes(needle)) {
        failures.push(`Expected thirdRequest user message content to include: ${needle}`);
      }
    }
  }

  mkdirSync(resultsDir, { recursive: true });
  const outputPath = join(resultsDir, "wave48-tool-result-replay-degradation-gate-latest.json");
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        gate: "wave48-tool-result-replay-degradation",
        thirdRequest,
        latestTurn,
        runtimeEvidence,
        passed: failures.length === 0,
        failures,
      },
      null,
      2,
    ),
    "utf8",
  );

  if (failures.length > 0) {
    fail("wave48 tool result replay degradation gate failed.", failures.join("\n"));
  }

  process.stdout.write("wave48 tool result replay degradation gate passed.\n");
  process.stdout.write(`Report: ${outputPath}\n`);
}

await runGate();
