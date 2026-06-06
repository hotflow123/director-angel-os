import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const pnpmBin = process.env.npm_execpath ?? (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-cycle-2-wave34-delegation-specialization-seam-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const cases = [
  {
    id: "cycle2_wave34_contracts_build",
    label: "contracts build publishes delegation specialization and target-agent fields",
    args: ["--filter", "@hotflow/contracts", "build"],
  },
  {
    id: "cycle2_wave34_contracts_tests",
    label: "contracts tests decode specialization and reject targetAgent without specialization",
    args: [
      "--filter",
      "@hotflow/contracts",
      "test",
      "--",
      "--runInBand",
      "test/task-events.test.ts",
    ],
  },
  {
    id: "cycle2_wave34_tasks_core_build",
    label: "tasks-core build compiles specialization replay, mailbox, and lifecycle projection",
    args: ["--filter", "@hotflow/tasks-core", "build"],
  },
  {
    id: "cycle2_wave34_tasks_core_tests",
    label: "tasks-core tests retain specialization through board, replay, mailbox, and lifecycle",
    args: [
      "--filter",
      "@hotflow/tasks-core",
      "test",
      "--",
      "--runInBand",
      "src/tasks.test.ts",
      "src/task-board.test.ts",
      "src/mailbox.test.ts",
      "src/session-task-plane-port.test.ts",
      "src/task-plane-port.test.ts",
    ],
  },
  {
    id: "cycle2_wave34_worker_jobs_build",
    label: "worker-jobs build compiles specialization fields in mailbox and run-delegation reports",
    args: ["--filter", "@hotflow/worker-jobs", "build"],
  },
  {
    id: "cycle2_wave34_worker_jobs_tests",
    label: "worker-jobs tests expose specialization without changing workerId routing",
    args: [
      "--filter",
      "@hotflow/worker-jobs",
      "test",
      "--",
      "--runInBand",
      "tests/delegation-flow.test.ts",
    ],
  },
  {
    id: "cycle2_wave34_control_plane_build",
    label: "control-plane build compiles delegation specialization through task surfaces",
    args: ["--filter", "@hotflow/control-plane", "build"],
  },
  {
    id: "cycle2_wave34_control_plane_tests",
    label: "control-plane tests preserve specialization fields across dispatch",
    args: [
      "--filter",
      "@hotflow/control-plane",
      "test",
      "--",
      "--runInBand",
      "tests/control-plane.test.ts",
    ],
  },
  {
    id: "cycle2_wave34_cli_build",
    label: "cli build compiles specialization parsing and rendering",
    args: ["--filter", "@hotflow/cli", "build"],
  },
  {
    id: "cycle2_wave34_cli_tests",
    label: "cli tests parse, dispatch, and render specialization surfaces",
    args: [
      "--filter",
      "@hotflow/cli",
      "test",
      "--",
      "--runInBand",
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
    `Director Cycle 2 Wave 34 delegation specialization seam gate completed: ${caseResults.length} cases, failed ${failed.length}\n`,
  );
  process.stdout.write(`Report: ${latestPath}\n`);

  if (failed.length > 0) {
    fail(
      "Director Cycle 2 Wave 34 delegation specialization seam gate failed.",
      failed.map((result) => `${result.id}: ${result.failures.join(" | ")}`).join("\n"),
    );
  }
}

await main();
