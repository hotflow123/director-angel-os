import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const packageName = "@hotflow/agent-os-sandbox";

function preview(output, lines = 40) {
  return String(output ?? "")
    .split("\n")
    .slice(0, lines)
    .join("\n");
}

function runStep(repoRoot, label, script) {
  const started = process.hrtime.bigint();
  const result = spawnSync(pnpmBin, ["--filter", packageName, script], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  return {
    label,
    command: `pnpm --filter ${packageName} ${script}`,
    status: result.status ?? -1,
    durationMs: Number(durationMs.toFixed(2)),
    stdoutPreview: preview(result.stdout),
    stderrPreview: preview(result.stderr),
  };
}

const { repoRoot, resultsDir } = getBenchmarksPaths();
const steps = [
  ["tests", "test"],
  ["types", "typecheck"],
  ["build", "build"],
  ["lint", "lint"],
];
const runs = steps.map(([label, script]) => runStep(repoRoot, label, script));
const failedRuns = runs.filter((run) => run.status !== 0);

mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(
  resultsDir,
  "director-phase-c-agent-os-sandbox-runtime-gate-latest.json",
);
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId: "director-phase-c-agent-os-sandbox-runtime-gate",
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
  `Director Agent OS sandbox runtime gate completed: ${runs.length} checks, failed ${failedRuns.length}\n`,
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
