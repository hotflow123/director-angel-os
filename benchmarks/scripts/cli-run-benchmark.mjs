import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths, runCliCommand } from "./cli-command.mjs";

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

const iterations = toPositiveInteger(process.env.HF_BENCH_ITERATIONS, 3);
const { benchmarksDir, resultsDir, tempDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "cli-run-scenarios.json");
const scenarios = JSON.parse(readFileSync(fixturePath, "utf8"));

const benchmarkRuns = [];
for (const scenario of scenarios) {
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const sessionDbPath = resolve(
      tempDir,
      `cli-bench-${scenario.id}-${iteration}-${Date.now()}.sqlite`,
    );
    const result = runCliCommand(
      ["run", scenario.prompt, "--provider", scenario.provider, "--model", scenario.model],
      { sessionDbPath },
    );

    benchmarkRuns.push({
      scenarioId: scenario.id,
      iteration,
      durationMs: Number(result.durationMs.toFixed(2)),
      ok: result.status === 0,
      status: result.status,
      hasSessionLine: result.stdout.includes("Session:"),
      hasOutputLine: result.stdout.includes("Output:"),
      stderr: result.stderr.trim(),
    });
  }
}

const durations = benchmarkRuns.map((run) => run.durationMs);
const failedRuns = benchmarkRuns.filter((run) => !run.ok);
const summary = {
  timestamp: new Date().toISOString(),
  iterations,
  totalRuns: benchmarkRuns.length,
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
const outputPath = resolve(resultsDir, "cli-run-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary,
      runs: benchmarkRuns,
    },
    null,
    2,
  ),
);

process.stdout.write(
  `CLI run benchmark completed: ${summary.totalRuns} runs, avg ${summary.durationMs.avg}ms, failed ${summary.failedRuns}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (summary.failedRuns > 0) {
  process.exitCode = 1;
}
