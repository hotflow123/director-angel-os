import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const steps = [
  {
    label: "policy-runtime-agent-os-execution-policy-preflight-tests",
    args: ["--filter", "@hotflow/policy-runtime", "test"],
  },
  {
    label: "policy-runtime-typecheck",
    args: ["--filter", "@hotflow/policy-runtime", "typecheck"],
  },
  {
    label: "policy-runtime-lint",
    args: ["--filter", "@hotflow/policy-runtime", "lint"],
  },
  {
    label: "policy-runtime-build",
    args: ["--filter", "@hotflow/policy-runtime", "build"],
  },
  {
    label: "conversation-runtime-agent-os-sandbox-preflight-tests",
    args: [
      "--filter",
      "@hotflow/conversation-runtime",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.config.ts",
      "tests/model-tool-loop.test.ts",
      "-t",
      "sandbox preflight",
    ],
  },
  {
    label: "conversation-runtime-external-tool-sandbox-preflight-tests",
    args: [
      "--filter",
      "@hotflow/conversation-runtime",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.config.ts",
      "tests/external-tools.test.ts",
      "-t",
      "sandbox preflight",
    ],
  },
  {
    label: "conversation-runtime-external-tool-sandbox-execution-plan-tests",
    args: [
      "--filter",
      "@hotflow/conversation-runtime",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.config.ts",
      "tests/external-tools.test.ts",
      "-t",
      "sandbox execution plan|policy-runtime sandbox policy|side-effectful invokes|adapter-level diagnostics",
    ],
  },
  {
    label: "conversation-runtime-tests",
    args: ["--filter", "@hotflow/conversation-runtime", "test"],
  },
  {
    label: "conversation-runtime-typecheck",
    args: ["--filter", "@hotflow/conversation-runtime", "typecheck"],
  },
  {
    label: "conversation-runtime-lint",
    args: ["--filter", "@hotflow/conversation-runtime", "lint"],
  },
  {
    label: "conversation-runtime-build",
    args: ["--filter", "@hotflow/conversation-runtime", "build"],
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
  "director-phase-c-agent-os-sandbox-preflight-gate-latest.json",
);
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId: "director-phase-c-agent-os-sandbox-preflight-gate",
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
  `Director Agent OS sandbox preflight gate completed: ${runs.length} checks, failed ${failedRuns.length}\n`,
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
