import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const pnpmBin = process.env.npm_execpath ?? (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-cycle-2-wave38-self-learning-orchestrator-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const cases = [
  {
    id: "cycle2_wave38_contracts_build",
    label: "contracts build publishes local-directory and web-page experience source kinds",
    args: ["--filter", "@hotflow/contracts", "build"],
  },
  {
    id: "cycle2_wave38_contracts_learning_tests",
    label: "contracts tests cover directory and web experience source declarations",
    args: ["--filter", "@hotflow/contracts", "test", "--", "--runInBand", "test/learning.test.ts"],
  },
  {
    id: "cycle2_wave38_director_knowledge_build",
    label: "director-knowledge build compiles self-learning adapters and orchestrator",
    args: ["--filter", "@hotflow/director-knowledge", "build"],
  },
  {
    id: "cycle2_wave38_director_knowledge_tests",
    label: "director-knowledge tests save local directory and web URL learning as candidates",
    args: [
      "--filter",
      "@hotflow/director-knowledge",
      "test",
      "--",
      "--runInBand",
      "test/self-learning.test.ts",
    ],
  },
  {
    id: "cycle2_wave38_cli_build",
    label: "cli build exposes director knowledge learn entrypoint",
    args: ["--filter", "@hotflow/cli", "build"],
  },
  {
    id: "cycle2_wave38_cli_knowledge_tests",
    label: "cli tests cover learning a user-provided local directory into experience candidates",
    args: [
      "--filter",
      "@hotflow/cli",
      "test",
      "--",
      "--runInBand",
      "src/director-knowledge.test.ts",
    ],
  },
  {
    id: "cycle2_wave38_targeted_format",
    label: "targeted Biome check covers self-learning and CLI learn files",
    args: [
      "exec",
      "biome",
      "check",
      "packages/contracts/src/learning.ts",
      "packages/contracts/test/learning.test.ts",
      "packages/director-knowledge/src/self-learning.ts",
      "packages/director-knowledge/test/self-learning.test.ts",
      "apps/cli/src/director-knowledge.ts",
      "apps/cli/src/director-knowledge.test.ts",
      "apps/cli/src/shell.ts",
      "benchmarks/scripts/director-cycle-2-wave38-self-learning-orchestrator-gate.mjs",
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
    `Director Cycle 2 Wave 38 self-learning orchestrator gate completed: ${caseResults.length} cases, failed ${failed.length}\n`,
  );
  process.stdout.write(`Report: ${latestPath}\n`);

  if (failed.length > 0) {
    fail(
      "Director Cycle 2 Wave 38 self-learning orchestrator gate failed.",
      failed.map((result) => `${result.id}: ${result.failures.join(" | ")}`).join("\n"),
    );
  }
}

await main();
