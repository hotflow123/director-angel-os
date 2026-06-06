import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function fail(message, details) {
  if (details) {
    process.stderr.write(`${message}\n${details}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function extractSessionId(output) {
  const match = /^Session:\s*(.+)$/mu.exec(output);
  return match?.[1]?.trim() ?? null;
}

function applyTokens(value, context) {
  if (typeof value !== "string") {
    return value;
  }
  if (context.sessionId) {
    return value.replaceAll("{{sessionId}}", context.sessionId);
  }
  return value;
}

function runPnpmCli(repoRoot, args, env) {
  const started = process.hrtime.bigint();
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(pnpmBin, args, {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", rejectPromise);
    child.once("close", (status) => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      resolvePromise({
        status,
        stdout,
        stderr,
        durationMs,
      });
    });
  });
}

async function runCliCommandWithEnv(repoRoot, commandArgs, options = {}) {
  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: repoRoot,
    HOTFLOW_CLI_SESSION_DB_PATH: options.sessionDbPath,
    ...options.env,
  };

  return runPnpmCli(repoRoot, ["--filter", "@hotflow/cli", "dev", "--", ...commandArgs], env);
}

function createMockResponses(mode, repoRoot) {
  if (mode === "success_roundtrip") {
    return [
      {
        status: 200,
        json: {
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "tool-readme",
                    function: {
                      name: "filesystem.read_text",
                      arguments: JSON.stringify({
                        path: `${repoRoot}/README.md`,
                      }),
                    },
                  },
                  {
                    id: "tool-todos",
                    function: {
                      name: "tasks.todo_write",
                      arguments: JSON.stringify({
                        items: [
                          {
                            id: "todo-wave7-1",
                            content: "Inspect provider runtime boundaries",
                            status: "todo",
                          },
                          {
                            id: "todo-wave7-2",
                            content: "Verify CLI failure contracts",
                            status: "todo",
                          },
                        ],
                      }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: {
            prompt_tokens: 21,
            completion_tokens: 8,
          },
        },
      },
      {
        status: 200,
        json: {
          choices: [
            {
              message: {
                content: "Repository summary complete.",
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 34,
            completion_tokens: 6,
          },
        },
      },
    ];
  }

  if (mode === "transient_429") {
    return [
      {
        status: 429,
        body: "rate limited",
        contentType: "text/plain",
      },
    ];
  }

  if (mode === "fatal_401") {
    return [
      {
        status: 401,
        body: "unauthorized",
        contentType: "text/plain",
      },
    ];
  }

  return [];
}

async function startMockOpenAIUpstream(mode, repoRoot) {
  const requests = [];
  const queue = createMockResponses(mode, repoRoot).slice();
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    let parsedBody = rawBody;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = rawBody;
    }

    requests.push({
      method: req.method ?? "GET",
      url: req.url ?? "/",
      body: parsedBody,
    });

    const response = queue.shift() ?? {
      status: 500,
      body: "unexpected extra request",
      contentType: "text/plain",
    };
    res.statusCode = response.status;
    res.setHeader("content-type", response.contentType ?? "application/json");
    if ("json" in response) {
      res.end(JSON.stringify(response.json));
      return;
    }
    res.end(response.body);
  });

  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });

  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error("Failed to bind mock upstream.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      await new Promise((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) {
            rejectPromise(error);
            return;
          }
          resolvePromise();
        });
      });
    },
  };
}

async function runCaseIteration(benchmarkCase, iteration, repoRoot, tempDir) {
  const runStartedAt = new Date().toISOString();
  const sessionDbPath = resolve(
    tempDir,
    `wave7-provider-${benchmarkCase.id}-${iteration}-${Date.now()}.sqlite`,
  );
  const context = { sessionId: null };
  const stepReports = [];
  let totalDurationMs = 0;
  let passed = true;
  let failureReason = "";

  const upstream =
    benchmarkCase.mode === "no_upstream"
      ? null
      : await startMockOpenAIUpstream(benchmarkCase.mode, repoRoot);

  try {
    const env =
      upstream === null
        ? {}
        : {
            HOTFLOW_OPENAI_BASE_URL: upstream.baseUrl,
            HOTFLOW_OPENAI_PROVIDER_ID:
              typeof benchmarkCase.providerId === "string"
                ? benchmarkCase.providerId
                : "openai-live",
            HOTFLOW_OPENAI_API_KEY: "test-wave7-key",
          };

    for (const step of benchmarkCase.steps) {
      const command = Array.isArray(step.command)
        ? step.command.map((token) => applyTokens(token, context))
        : [];
      const result = await runCliCommandWithEnv(repoRoot, command, {
        sessionDbPath,
        env,
      });
      totalDurationMs += result.durationMs;

      const combinedOutput = `${result.stdout}${result.stderr}`;
      if (step.captureSessionId === true || !context.sessionId) {
        const maybeSessionId = extractSessionId(combinedOutput);
        if (maybeSessionId) {
          context.sessionId = maybeSessionId;
        }
      }

      const expectedOutputIncludes = Array.isArray(step.expectOutputIncludes)
        ? step.expectOutputIncludes.map((entry) => applyTokens(entry, context))
        : [];
      const missingOutputIncludes = expectedOutputIncludes.filter(
        (needle) => typeof needle === "string" && !combinedOutput.includes(needle),
      );
      const expectedStatus = typeof step.expectStatus === "number" ? step.expectStatus : 0;
      const stepOk = result.status === expectedStatus && missingOutputIncludes.length === 0;

      stepReports.push({
        id: step.id,
        ok: stepOk,
        status: result.status,
        expectedStatus,
        durationMs: Number(result.durationMs.toFixed(2)),
        command,
        expectedOutputIncludes,
        missingOutputIncludes,
        stdoutPreview: result.stdout.split("\n").slice(0, 20).join("\n"),
        stderrPreview: result.stderr.split("\n").slice(0, 20).join("\n"),
      });

      if (!stepOk) {
        passed = false;
        failureReason =
          result.status !== expectedStatus
            ? `Step ${step.id} exited with ${result.status}, expected ${expectedStatus}.`
            : `Step ${step.id} missing output fragments: ${missingOutputIncludes.join(", ")}`;
        break;
      }
    }

    const requestCount = upstream?.requests.length ?? 0;
    if (
      passed &&
      typeof benchmarkCase.expectRequestCount === "number" &&
      requestCount !== benchmarkCase.expectRequestCount
    ) {
      passed = false;
      failureReason = `Expected ${benchmarkCase.expectRequestCount} upstream requests, got ${requestCount}.`;
    }

    return {
      caseId: benchmarkCase.id,
      iteration,
      ok: passed,
      startedAt: runStartedAt,
      finishedAt: new Date().toISOString(),
      sessionId: context.sessionId,
      durationMs: Number(totalDurationMs.toFixed(2)),
      failureReason,
      requestCount,
      requestPreview: (upstream?.requests ?? []).map((request) => ({
        method: request.method,
        url: request.url,
        body:
          request.body && typeof request.body === "object" && !Array.isArray(request.body)
            ? {
                model: request.body.model,
                messageCount: Array.isArray(request.body.messages)
                  ? request.body.messages.length
                  : 0,
              }
            : request.body,
      })),
      steps: stepReports,
    };
  } finally {
    if (upstream) {
      await upstream.close();
    }
  }
}

const { benchmarksDir, resultsDir, tempDir, repoRoot } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave7-provider-run-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

if (!Array.isArray(fixture.cases) || fixture.cases.length === 0) {
  fail("No Wave 7 provider run cases found in fixture.");
}

const selectedCases = fixture.cases.filter(
  (benchmarkCase) =>
    benchmarkCase &&
    typeof benchmarkCase.id === "string" &&
    typeof benchmarkCase.mode === "string" &&
    Array.isArray(benchmarkCase.steps) &&
    benchmarkCase.steps.length > 0,
);
if (selectedCases.length === 0) {
  fail("No valid Wave 7 provider run cases selected from fixture.");
}

const iterations = toPositiveInteger(
  process.env.HF_WAVE7_PROVIDER_ITERATIONS,
  toPositiveInteger(fixture.iterations, 1),
);

const runs = [];
for (const benchmarkCase of selectedCases) {
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    runs.push(await runCaseIteration(benchmarkCase, iteration, repoRoot, tempDir));
  }
}

const failedRuns = runs.filter((run) => !run.ok);
const durations = runs.map((run) => run.durationMs);
const summary = {
  suiteId: typeof fixture.suiteId === "string" ? fixture.suiteId : "wave7-provider-run-gate",
  timestamp: new Date().toISOString(),
  iterations,
  totalRuns: runs.length,
  failedRuns: failedRuns.length,
  durationMs: {
    min: durations.length > 0 ? Math.min(...durations) : 0,
    max: durations.length > 0 ? Math.max(...durations) : 0,
    avg:
      durations.length > 0
        ? Number((durations.reduce((acc, value) => acc + value, 0) / durations.length).toFixed(2))
        : 0,
  },
};

mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave7-provider-run-gate-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary,
      runs,
    },
    null,
    2,
  ),
);

process.stdout.write(
  `Wave 7 provider run gate completed: ${summary.totalRuns} runs, failed ${summary.failedRuns}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (summary.failedRuns > 0) {
  process.exitCode = 1;
}
