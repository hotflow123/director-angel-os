import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const pnpmBin = process.env.npm_execpath ?? (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-cycle-2-wave28-app-wiring-turn-reasoning-surface-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const cases = [
  {
    id: "cycle2_wave28_runtime_bootstrap_build",
    label: "runtime-bootstrap build compiles shared surface turn reasoning helper",
    args: ["--filter", "@hotflow/runtime-bootstrap", "build"],
  },
  {
    id: "cycle2_wave28_runtime_bootstrap_tests",
    label: "runtime-bootstrap tests cover CLI and gateway default reasoning surface inputs",
    args: [
      "--filter",
      "@hotflow/runtime-bootstrap",
      "test",
      "--",
      "tests/turn-reasoning-surface.test.ts",
    ],
  },
  {
    id: "cycle2_wave28_cli_build",
    label: "CLI build compiles workbench reasoning wiring for golden-path/run/resume",
    args: ["--filter", "@hotflow/cli", "build"],
  },
  {
    id: "cycle2_wave28_cli_tests",
    label: "CLI tests cover workbench defaults and resume reasoning reuse",
    args: ["--filter", "@hotflow/cli", "test", "--", "src/shell.test.ts"],
  },
  {
    id: "cycle2_wave28_gateway_build",
    label: "gateway build compiles channel-message reasoning surface wiring",
    args: ["--filter", "@hotflow/gateway", "build"],
  },
  {
    id: "cycle2_wave28_gateway_tests",
    label: "gateway tests cover react defaults and metadata override reasoning evidence",
    args: ["--filter", "@hotflow/gateway", "test", "--", "tests/server.test.ts"],
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
    `Director Cycle 2 Wave 28 app wiring turn reasoning surface gate completed: ${caseResults.length} cases, failed ${failed.length}\n`,
  );
  process.stdout.write(`Report: ${latestPath}\n`);

  if (failed.length > 0) {
    fail(
      "Director Cycle 2 Wave 28 app wiring turn reasoning surface gate failed.",
      failed.map((result) => `${result.id}: ${result.failures.join(" | ")}`).join("\n"),
    );
  }
}

await main();
