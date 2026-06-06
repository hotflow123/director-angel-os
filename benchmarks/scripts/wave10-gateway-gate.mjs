import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createGatewayApp } from "../../apps/gateway/dist/server.js";
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

function replaceReadmePlaceholder(value, readmePath) {
  if (typeof value === "string") {
    return value.replaceAll("__README__", readmePath);
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceReadmePlaceholder(item, readmePath));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceReadmePlaceholder(item, readmePath)]),
    );
  }
  return value;
}

async function runCase(benchmarkCase, baseUrl, readmePath) {
  const request = replaceReadmePlaceholder(benchmarkCase.request, readmePath);
  const failures = [];
  const started = process.hrtime.bigint();
  const response = await fetch(`${baseUrl}${request.path}`, {
    method: request.method,
    headers: request.body ? { "content-type": "application/json" } : undefined,
    body: request.body ? JSON.stringify(request.body) : undefined,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  const bodyText = await response.text();
  let body;
  try {
    body = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
  } catch (error) {
    failures.push(`Response body is not valid JSON: ${String(error)}`);
  }

  if (response.status !== benchmarkCase.expect.status) {
    failures.push(
      `Expected status ${benchmarkCase.expect.status} but received ${response.status}.`,
    );
  }
  if (benchmarkCase.expect.jsonSubset) {
    failures.push(...compareSubset(body, benchmarkCase.expect.jsonSubset, "body"));
  }
  for (const needle of benchmarkCase.expect.bodyIncludes ?? []) {
    if (!bodyText.includes(needle)) {
      failures.push(`Expected response body to include ${needle}.`);
    }
  }

  return {
    caseId: benchmarkCase.id,
    durationMs,
    ok: failures.length === 0,
    failures,
  };
}

const { benchmarksDir, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave10-gateway-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-bench-gateway-"));
const dataDir = join(workspaceRoot, ".hotflow");
const readmePath = join(workspaceRoot, "README.md");

mkdirSync(join(dataDir, "sessions"), { recursive: true });
writeFileSync(readmePath, "Agent OS repository details for gateway benchmark.\n", "utf8");

const app = createGatewayApp({
  env: {
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_GATEWAY_SESSION_DB_PATH: join(dataDir, "sessions", "wave10-gateway.sqlite"),
  },
});

try {
  const started = await app.start({ host: "127.0.0.1", port: 0 });
  const baseUrl = `http://${normalizeHost(started.host)}:${started.port}`;
  const runs = [];

  for (const benchmarkCase of fixture.cases) {
    runs.push(await runCase(benchmarkCase, baseUrl, readmePath));
  }

  const failedRuns = runs.filter((run) => !run.ok);
  mkdirSync(resultsDir, { recursive: true });
  const outputPath = resolve(resultsDir, "wave10-gateway-gate-latest.json");
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        summary: {
          suiteId: fixture.suiteId ?? "wave10-gateway-gate",
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
    `Wave 10 gateway gate completed: ${runs.length} runs, failed ${failedRuns.length}\n`,
  );
  process.stdout.write(`Report: ${outputPath}\n`);

  if (failedRuns.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await app.close();
  rmSync(workspaceRoot, { recursive: true, force: true });
}
