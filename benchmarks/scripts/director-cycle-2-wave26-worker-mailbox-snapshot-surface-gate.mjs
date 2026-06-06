import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const pnpmBin = process.env.npm_execpath ?? (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-cycle-2-wave26-worker-mailbox-snapshot-surface-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const cases = [
  {
    id: "cycle2_wave26_tasks_core_build",
    label: "tasks-core build publishes worker mailbox snapshot helpers and ports",
    args: ["--filter", "@hotflow/tasks-core", "build"],
  },
  {
    id: "cycle2_wave26_tasks_core_tests",
    label: "tasks-core tests cover worker mailbox snapshot selectors and session projection",
    args: [
      "--filter",
      "@hotflow/tasks-core",
      "test",
      "--",
      "src/mailbox.test.ts",
      "src/session-task-plane-port.test.ts",
      "src/task-plane-port.test.ts",
    ],
  },
  {
    id: "cycle2_wave26_control_plane_build",
    label: "control-plane build compiles task-worker-mailbox routing",
    args: ["--filter", "@hotflow/control-plane", "build"],
  },
  {
    id: "cycle2_wave26_control_plane_tests",
    label: "control-plane tests cover task-worker-mailbox action dispatch",
    args: ["--filter", "@hotflow/control-plane", "test", "--", "tests/control-plane.test.ts"],
  },
  {
    id: "cycle2_wave26_worker_jobs_build",
    label: "worker-jobs build compiles shared worker mailbox snapshot reuse",
    args: ["--filter", "@hotflow/worker-jobs", "build"],
  },
  {
    id: "cycle2_wave26_worker_jobs_tests",
    label: "worker-jobs tests render aligned worker mailbox snapshot output",
    args: ["--filter", "@hotflow/worker-jobs", "test", "--", "tests/delegation-flow.test.ts"],
  },
  {
    id: "cycle2_wave26_cli_build",
    label: "cli build compiles task mailbox control-plane surface",
    args: ["--filter", "@hotflow/cli", "build"],
  },
  {
    id: "cycle2_wave26_cli_tests",
    label: "cli tests parse, dispatch, and render task mailbox snapshot output",
    args: [
      "--filter",
      "@hotflow/cli",
      "test",
      "--",
      "src/shell.test.ts",
      "src/control-plane-adapter.test.ts",
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
    `Director Cycle 2 Wave 26 worker mailbox snapshot surface gate completed: ${caseResults.length} cases, failed ${failed.length}\n`,
  );
  process.stdout.write(`Report: ${latestPath}\n`);

  if (failed.length > 0) {
    fail(
      "Director Cycle 2 Wave 26 worker mailbox snapshot surface gate failed.",
      failed.map((result) => `${result.id}: ${result.failures.join(" | ")}`).join("\n"),
    );
  }
}

await main();
