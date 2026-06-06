import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const pnpmBin = process.env.npm_execpath ?? (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-cycle-2-wave41-global-experience-runtime-recall-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const cases = [
  {
    id: "cycle2_wave41_director_knowledge_build",
    label: "director-knowledge build compiles opt-in global experience recall",
    args: ["--filter", "@hotflow/director-knowledge", "build"],
  },
  {
    id: "cycle2_wave41_director_knowledge_recall_tests",
    label: "director-knowledge recall tests cover opt-in global self-learning experience",
    args: [
      "--filter",
      "@hotflow/director-knowledge",
      "test",
      "--",
      "--runInBand",
      "test/recall.test.ts",
    ],
  },
  {
    id: "cycle2_wave41_director_service_build",
    label: "director-service build compiles runtime recall query update",
    args: ["--filter", "@hotflow/director-service", "build"],
  },
  {
    id: "cycle2_wave41_director_service_tests",
    label:
      "director-service tests inject published self-learning experience into execution knowledge",
    args: [
      "--filter",
      "@hotflow/director-service",
      "test",
      "--",
      "--runInBand",
      "tests/service.test.ts",
    ],
  },
  {
    id: "cycle2_wave41_cli_build",
    label: "cli build remains compatible with recall query contract",
    args: ["--filter", "@hotflow/cli", "build"],
  },
  {
    id: "cycle2_wave41_targeted_format",
    label: "targeted Biome check covers runtime global experience recall files",
    args: [
      "exec",
      "biome",
      "check",
      "packages/director-knowledge/src/recall.ts",
      "packages/director-knowledge/test/recall.test.ts",
      "packages/director-service/src/service.ts",
      "packages/director-service/tests/service.test.ts",
      "benchmarks/scripts/director-cycle-2-wave41-global-experience-runtime-recall-gate.mjs",
    ],
  },
];

function preview(output, lines = 25) {
  return String(output ?? "")
    .split("\n")
    .slice(0, lines)
    .join("\n");
}

function runPnpm(args) {
  const started = process.hrtime.bigint();
  const result = spawnSync(pnpmBin, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs: Number(durationMs.toFixed(2)),
  };
}

function fail(message, details) {
  process.stderr.write(`${message}\n`);
  if (details) {
    process.stderr.write(`${details}\n`);
  }
  process.exit(1);
}

async function main() {
  mkdirSync(resultsDir, { recursive: true });

  const caseResults = cases.map((benchmarkCase) => {
    const result = runPnpm(benchmarkCase.args);
    return {
      id: benchmarkCase.id,
      label: benchmarkCase.label,
      status: result.status === 0 ? "passed" : "failed",
      durationMs: result.durationMs,
      command: `${pnpmBin} ${benchmarkCase.args.join(" ")}`,
      stdoutPreview: preview(result.stdout),
      stderrPreview: preview(result.stderr),
      failures:
        result.status === 0
          ? []
          : [`command exited with ${result.status}`, preview(result.stderr || result.stdout)],
    };
  });

  const failed = caseResults.filter((result) => result.status !== "passed");
  const report = {
    suiteId,
    generatedAt: new Date().toISOString(),
    summary: {
      total: caseResults.length,
      failed: failed.length,
      passed: caseResults.length - failed.length,
      totalDurationMs: Number(
        caseResults.reduce((sum, result) => sum + result.durationMs, 0).toFixed(2),
      ),
    },
    caseResults,
  };

  writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  process.stdout.write(
    `Director Cycle 2 Wave 41 global experience runtime recall gate completed: ${caseResults.length} cases, failed ${failed.length}\n`,
  );
  process.stdout.write(`Report: ${latestPath}\n`);

  if (failed.length > 0) {
    fail(
      "Director Cycle 2 Wave 41 global experience runtime recall gate failed.",
      failed.map((result) => `${result.id}: ${result.failures.join(" | ")}`).join("\n"),
    );
  }
}

await main();
