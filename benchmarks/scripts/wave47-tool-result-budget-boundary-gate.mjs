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

async function captureContinuationRequest() {
  const { workspaceRoot, sessionDbPath } = createWorkspace("hotflow-wave47");
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
      text: "final answer",
    },
  ];

  try {
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher() {
        return {
          async dispatch() {
            return {
              toolCallId: "call-1",
              toolName: "filesystem.read_text",
              ok: true,
              output: {
                blob: "A".repeat(3_000),
              },
              resolution: "executed",
            };
          },
        };
      },
      memory: createMemory("session_wave47"),
      modelRuntime: {
        async generate({ request }) {
          capturedRequests.push(request);
          const next = modelOutputs.shift();
          if (!next) {
            throw new Error("missing model output in wave47 gate");
          }
          return next;
        },
      },
      sessionStore: store,
      workspaceRoot,
    });

    await engine.runTurn({
      sessionId: "session_wave47",
      turnId: "turn_wave47",
      userText: "Read the repository file and summarize it under a tight replay budget.",
      providerId: "openai-compatible",
      model: "gpt-wave47",
      tokenBudget: 80,
      maxSteps: 2,
    });
  } finally {
    store.close();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }

  return capturedRequests[1];
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
        `build failed for ${target} during wave47 tool result budget boundary gate.`,
        build.stderr,
      );
    }
  }

  const failures = [];
  const continuationRequest = await captureContinuationRequest();
  const assistantMessage = continuationRequest?.messages.find(
    (message) => message.role === "assistant" && Array.isArray(message.toolCalls),
  );
  const toolMessage = continuationRequest?.messages.find((message) => message.role === "tool");
  const parsedToolContent =
    typeof toolMessage?.content === "string" ? JSON.parse(toolMessage.content) : null;

  failures.push(
    ...compareSubset(
      assistantMessage,
      {
        role: "assistant",
        content: "I need to inspect the large file first.",
        toolCalls: [
          {
            id: "call-1",
            name: "filesystem.read_text",
            argumentsJson: '{"path":"README.md"}',
          },
        ],
      },
      "continuationRequest.assistantMessage",
    ),
    ...compareSubset(
      toolMessage,
      {
        role: "tool",
        name: "filesystem.read_text",
        toolCallId: "call-1",
      },
      "continuationRequest.toolMessage",
    ),
    ...compareSubset(
      parsedToolContent,
      {
        ok: true,
        resolution: "executed",
        truncated: true,
      },
      "continuationRequest.toolMessage.content",
    ),
  );

  if (typeof toolMessage?.content !== "string") {
    failures.push("Expected continuationRequest.toolMessage.content to be a string.");
  } else {
    if (toolMessage.content.length >= 260) {
      failures.push(
        `Expected continuationRequest.toolMessage.content length < 260 but received ${toolMessage.content.length}.`,
      );
    }
    if (!toolMessage.content.includes('"outputPreview"')) {
      failures.push("Expected continuationRequest.toolMessage.content to include outputPreview.");
    }
  }

  mkdirSync(resultsDir, { recursive: true });
  const outputPath = join(resultsDir, "wave47-tool-result-budget-boundary-gate-latest.json");
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        gate: "wave47-tool-result-budget-boundary",
        continuationRequest,
        parsedToolContent,
        passed: failures.length === 0,
        failures,
      },
      null,
      2,
    ),
    "utf8",
  );

  if (failures.length > 0) {
    fail("wave47 tool result budget boundary gate failed.", failures.join("\n"));
  }

  process.stdout.write("wave47 tool result budget boundary gate passed.\n");
  process.stdout.write(`Report: ${outputPath}\n`);
}

await runGate();
