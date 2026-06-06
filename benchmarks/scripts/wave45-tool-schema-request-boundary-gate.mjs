import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DynamicContextAssembler } from "../../packages/context/dist/index.js";
import { PhaseOneEngine } from "../../packages/engine/dist/index.js";
import { OpenAICompatibleProvider } from "../../packages/models/dist/index.js";
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

const toolSchemas = [
  {
    name: "filesystem.read_text",
    description: "Read a UTF-8 text file from the workspace.",
    toolset: "filesystem",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
        },
      },
      required: ["path"],
    },
  },
];

async function captureEngineRequest() {
  const { workspaceRoot, sessionDbPath } = createWorkspace("hotflow-wave45");
  const store = new SessionStore({ dbPath: sessionDbPath });
  const capturedRequests = [];

  try {
    const engine = new PhaseOneEngine({
      contextAssembler: new DynamicContextAssembler(),
      createDispatcher() {
        return {
          async dispatch() {
            throw new Error("dispatch should not run in wave45 tool schema request boundary gate");
          },
          getSchemas() {
            return toolSchemas;
          },
        };
      },
      memory: createMemory("session_wave45"),
      modelRuntime: {
        async generate({ request }) {
          capturedRequests.push(request);
          return {
            text: "wave45 final answer",
          };
        },
      },
      sessionStore: store,
      workspaceRoot,
    });

    await engine.runTurn({
      sessionId: "session_wave45",
      turnId: "turn_wave45",
      userText: "Read the release note from the workspace.",
      providerId: "openai-compatible",
      model: "gpt-wave45",
      maxSteps: 1,
    });
  } finally {
    store.close();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }

  return capturedRequests[0];
}

async function captureProviderRequestBody() {
  let requestBody;
  const provider = new OpenAICompatibleProvider({
    baseUrl: "https://example.invalid/v1",
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "wave45 provider response",
              },
              finish_reason: "stop",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  await provider.generate({
    model: "gpt-wave45",
    messages: [{ role: "user", content: "hello" }],
    tools: toolSchemas,
  });

  return requestBody;
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
        `build failed for ${target} during wave45 tool schema request boundary gate.`,
        build.stderr,
      );
    }
  }

  const failures = [];
  const engineRequest = await captureEngineRequest();
  const providerRequestBody = await captureProviderRequestBody();

  failures.push(
    ...compareSubset(engineRequest?.tools, toolSchemas, "engineRequest.tools"),
    ...compareSubset(
      providerRequestBody,
      {
        model: "gpt-wave45",
        tool_choice: "auto",
        tools: [
          {
            type: "function",
            function: {
              name: "filesystem.read_text",
              description: "Read a UTF-8 text file from the workspace.",
              parameters: {
                type: "object",
                properties: {
                  path: {
                    type: "string",
                  },
                },
                required: ["path"],
              },
            },
          },
        ],
      },
      "providerRequestBody",
    ),
  );

  mkdirSync(resultsDir, { recursive: true });
  const outputPath = join(resultsDir, "wave45-tool-schema-request-boundary-gate-latest.json");
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        gate: "wave45-tool-schema-request-boundary",
        engineRequest,
        providerRequestBody,
        passed: failures.length === 0,
        failures,
      },
      null,
      2,
    ),
    "utf8",
  );

  if (failures.length > 0) {
    fail("wave45 tool schema request boundary gate failed.", failures.join("\n"));
  }

  process.stdout.write("wave45 tool schema request boundary gate passed.\n");
  process.stdout.write(`Report: ${outputPath}\n`);
}

await runGate();
