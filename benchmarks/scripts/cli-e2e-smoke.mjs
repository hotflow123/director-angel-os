import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths, runCliCommand } from "./cli-command.mjs";

function fail(message, details) {
  if (details) {
    process.stderr.write(`${message}\n${details}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

const { benchmarksDir, resultsDir, tempDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "cli-run-scenarios.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const scenario = fixture[0];

if (!scenario) {
  fail("No benchmark scenario found in fixtures/cli-run-scenarios.json.");
}

const sessionDbPath = resolve(tempDir, `cli-e2e-${Date.now()}.sqlite`);
const runResult = runCliCommand(
  ["run", scenario.prompt, "--provider", scenario.provider, "--model", scenario.model],
  { sessionDbPath },
);

if (runResult.status !== 0) {
  fail("CLI run command failed during smoke test.", runResult.stderr || runResult.stdout);
}

if (!runResult.stdout.includes("Session:")) {
  fail("CLI run output is missing Session line.", runResult.stdout);
}
if (!runResult.stdout.includes("Provider:")) {
  fail("CLI run output is missing Provider line.", runResult.stdout);
}
if (!runResult.stdout.includes("Model:")) {
  fail("CLI run output is missing Model line.", runResult.stdout);
}
if (!runResult.stdout.includes("Output:")) {
  fail("CLI run output is missing Output line.", runResult.stdout);
}

const sessionMatch = /^Session:\s*(.+)$/mu.exec(runResult.stdout);
if (!sessionMatch?.[1]) {
  fail("Could not extract session id from CLI run output.", runResult.stdout);
}
const sessionId = sessionMatch[1].trim();

const resumeResult = runCliCommand(["resume", sessionId], { sessionDbPath });
if (resumeResult.status !== 0) {
  fail("CLI resume command failed during smoke test.", resumeResult.stderr || resumeResult.stdout);
}
if (!resumeResult.stdout.includes("First step:")) {
  fail("CLI resume output is missing First step line.", resumeResult.stdout);
}

mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "cli-e2e-smoke-latest.json");
const report = {
  timestamp: new Date().toISOString(),
  scenarioId: scenario.id,
  sessionId,
  runDurationMs: runResult.durationMs,
  resumeDurationMs: resumeResult.durationMs,
};
writeFileSync(outputPath, JSON.stringify(report, null, 2));

process.stdout.write(`Smoke e2e passed for scenario ${scenario.id}\n`);
process.stdout.write(`Report: ${outputPath}\n`);
