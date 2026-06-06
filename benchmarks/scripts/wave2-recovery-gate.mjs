import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

function runPnpm(repoRoot, args) {
  return spawnSync(pnpmBin, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
}

const { repoRoot, benchmarksDir, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave2-recovery-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const caseIds = Array.isArray(fixture.caseIds)
  ? fixture.caseIds.filter((caseId) => typeof caseId === "string")
  : [];

const buildResult = runPnpm(repoRoot, ["--filter", "@hotflow/testkit", "build"]);
if (buildResult.status !== 0) {
  fail(
    "Failed to build @hotflow/testkit before recovery gate.",
    `${buildResult.stderr}\n${buildResult.stdout}`,
  );
}

const testkitEntry = pathToFileURL(
  resolve(repoRoot, "packages", "testkit", "dist", "index.js"),
).href;
const testkitModule = await import(testkitEntry);
const createWave2RecoveryBenchmarkCases = testkitModule.createWave2RecoveryBenchmarkCases;
const runBenchmarkGate = testkitModule.runBenchmarkGate;

if (
  typeof createWave2RecoveryBenchmarkCases !== "function" ||
  typeof runBenchmarkGate !== "function"
) {
  fail("Missing recovery benchmark exports from @hotflow/testkit.");
}

const definedCases = createWave2RecoveryBenchmarkCases();
const selectedCases =
  caseIds.length > 0
    ? definedCases.filter((benchmarkCase) => caseIds.includes(benchmarkCase.id))
    : definedCases;

if (selectedCases.length === 0) {
  fail("No Wave 2 recovery cases selected from fixture.");
}

const iterations = toPositiveInteger(
  process.env.HF_WAVE2_RECOVERY_ITERATIONS,
  toPositiveInteger(fixture.iterations, 1),
);
const report = await runBenchmarkGate({
  suiteId: typeof fixture.suiteId === "string" ? fixture.suiteId : "wave2-recovery-gate",
  cases: selectedCases,
  iterations,
});

mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave2-recovery-gate-latest.json");
writeFileSync(outputPath, JSON.stringify(report, null, 2));

process.stdout.write(
  `Wave 2 recovery gate completed: ${report.summary.totalRuns} runs, failed ${report.summary.failedRuns}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (report.summary.failedRuns > 0) {
  process.exitCode = 1;
}
