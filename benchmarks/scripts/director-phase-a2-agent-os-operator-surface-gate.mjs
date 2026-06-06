import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const steps = [
  {
    label: "cli-session-observation-tests",
    args: ["--filter", "@hotflow/cli", "test", "--", "src/session-observation.test.ts"],
  },
  {
    label: "cli-status-agent-os-surface-tests",
    args: [
      "--filter",
      "@hotflow/cli",
      "test",
      "--",
      "src/shell.test.ts",
      "-t",
      "prefers control-plane status snapshot when available",
    ],
  },
  {
    label: "cli-typecheck",
    args: ["--filter", "@hotflow/cli", "typecheck"],
  },
  {
    label: "cli-lint",
    args: ["--filter", "@hotflow/cli", "lint"],
  },
  {
    label: "doctor-typecheck",
    args: ["--filter", "@hotflow/doctor", "typecheck"],
  },
  {
    label: "doctor-tests",
    args: ["--filter", "@hotflow/doctor", "test"],
  },
];

function preview(output, lines = 40) {
  return String(output ?? "")
    .split("\n")
    .slice(0, lines)
    .join("\n");
}

function runStep(repoRoot, step) {
  const started = process.hrtime.bigint();
  const result = spawnSync(pnpmBin, step.args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  return {
    label: step.label,
    command: `pnpm ${step.args.join(" ")}`,
    status: result.status ?? -1,
    durationMs: Number(durationMs.toFixed(2)),
    stdoutPreview: preview(result.stdout),
    stderrPreview: preview(result.stderr),
  };
}

const { repoRoot, resultsDir } = getBenchmarksPaths();
const runs = steps.map((step) => runStep(repoRoot, step));
const failedRuns = runs.filter((run) => run.status !== 0);

mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(
  resultsDir,
  "director-phase-a2-agent-os-operator-surface-gate-latest.json",
);
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId: "director-phase-a2-agent-os-operator-surface-gate",
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
  `Director Agent OS operator surface gate completed: ${runs.length} checks, failed ${failedRuns.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (failedRuns.length > 0) {
  for (const failedRun of failedRuns) {
    process.stderr.write(
      [
        `${failedRun.label} failed with status ${failedRun.status}`,
        failedRun.stderrPreview,
        failedRun.stdoutPreview,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    process.stderr.write("\n");
  }
  process.exitCode = 1;
}
