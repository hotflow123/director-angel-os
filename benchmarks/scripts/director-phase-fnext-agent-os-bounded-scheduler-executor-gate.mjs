import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-fnext-agent-os-bounded-scheduler-executor-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const requiredSourceCoverage = [
  {
    id: "worker-jobs-scheduler-executor-source",
    path: "apps/worker-jobs/src/scheduler-executor.ts",
    needles: [
      "runSchedulerExecutorJob",
      'executorMode: "bounded-local"',
      "runSchedulerTickJob",
      "runDelegationJob",
      "maxDispatches",
      "executedDispatchIntents",
      "finalSchedulerTick",
      "skippedDispatchIntentIds",
    ],
  },
  {
    id: "worker-jobs-scheduler-executor-cli-source",
    path: "apps/worker-jobs/src/main.ts",
    needles: [
      "runSchedulerExecutorJob",
      "ParsedSchedulerExecutorCommand",
      "scheduler-executor",
      "--max-dispatches",
      "parseSchedulerExecutorCommand",
    ],
  },
  {
    id: "worker-jobs-scheduler-executor-bootstrap-source",
    path: "apps/worker-jobs/src/bootstrap.ts",
    needles: ["runSchedulerExecutorJob", "schedulerExecutor"],
  },
  {
    id: "worker-jobs-scheduler-executor-test-source",
    path: "apps/worker-jobs/tests/delegation-flow.test.ts",
    needles: [
      "scheduler-executor consumes bounded dispatch intents from scheduler tick",
      "executedDispatchIntents",
      "d_ready_beta",
      "d_ready_gamma",
      "d_blocked_alpha",
      "finalSchedulerTick",
    ],
  },
];

const forbiddenSourceCoverage = [
  {
    id: "scheduler-executor-no-direct-process-runner",
    path: "apps/worker-jobs/src/scheduler-executor.ts",
    forbidden: ["child_process", "spawn(", "exec("],
  },
  {
    id: "scheduler-executor-no-direct-claim-side-door",
    path: "apps/worker-jobs/src/scheduler-executor.ts",
    forbidden: ["claimDelegation(", "setDelegationStatus("],
  },
  {
    id: "scheduler-executor-no-remote-write-language",
    path: "apps/worker-jobs/src/scheduler-executor.ts",
    forbidden: ["remoteWrite", "remoteExecution", "remote-runner"],
  },
];

const commandChecks = [
  {
    label: "worker-jobs scheduler executor focused tests",
    args: [
      "--filter",
      "@hotflow/worker-jobs",
      "test",
      "--",
      "tests/delegation-flow.test.ts",
      "-t",
      "scheduler-executor|scheduler-tick|bounded scheduler loop|scheduler-blocked",
    ],
  },
  {
    label: "worker-jobs typecheck",
    args: ["--filter", "@hotflow/worker-jobs", "typecheck"],
  },
  {
    label: "worker-jobs build",
    args: ["--filter", "@hotflow/worker-jobs", "build"],
  },
  {
    label: "worker-jobs lint",
    args: ["--filter", "@hotflow/worker-jobs", "lint"],
  },
];

function preview(output, lines = 40) {
  return String(output ?? "")
    .split("\n")
    .slice(0, lines)
    .join("\n");
}

function readText(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function runPnpm(label, args) {
  const started = process.hrtime.bigint();
  const result = spawnSync(pnpmBin, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return {
    label,
    command: `pnpm ${args.join(" ")}`,
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status ?? -1,
    durationMs: Number(durationMs.toFixed(2)),
    stdoutPreview: preview(result.stdout),
    stderrPreview: preview(result.stderr),
  };
}

const sourceIssues = requiredSourceCoverage.flatMap((item) => {
  const source = readText(item.path);
  return item.needles
    .filter((needle) => !source.includes(needle))
    .map((needle) => ({
      rule: "source-coverage",
      file: item.path,
      detail: `${item.id} missing ${needle}`,
    }));
});

const forbiddenIssues = forbiddenSourceCoverage.flatMap((item) => {
  const source = readText(item.path);
  return item.forbidden
    .filter((needle) => source.includes(needle))
    .map((needle) => ({
      rule: "forbidden-source",
      file: item.path,
      detail: `${item.id} contains ${needle}`,
    }));
});

const commandRuns = commandChecks.map((check) => runPnpm(check.label, check.args));
const commandIssues = commandRuns
  .filter((run) => run.status !== "passed")
  .map((run) => ({
    rule: "command",
    file: null,
    detail: `${run.label} failed with exit ${run.exitCode}`,
  }));

const issues = [...sourceIssues, ...forbiddenIssues, ...commandIssues];

mkdirSync(resultsDir, { recursive: true });
const report = {
  suiteId,
  generatedAt: new Date().toISOString(),
  summary: {
    status: issues.length === 0 ? "passed" : "failed",
    sourceCoverageChecks: requiredSourceCoverage.length,
    forbiddenSourceChecks: forbiddenSourceCoverage.length,
    commandChecks: commandRuns.length,
    issueCount: issues.length,
    executor: {
      mode: "bounded-local",
      maxDispatchesCap: 10,
      dispatchSource: "scheduler-tick-intents",
      directProcessRunnerAllowed: false,
      remoteWriteExecutionAllowed: false,
    },
  },
  requiredSourceCoverage,
  forbiddenSourceCoverage,
  commandRuns,
  issues,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS bounded scheduler executor gate completed: ${report.summary.status}\n`,
);
process.stdout.write(`Checks ${commandRuns.length}, issues ${issues.length}\n`);
process.stdout.write(`Report: ${latestPath}\n`);

if (issues.length > 0) {
  for (const issue of issues) {
    process.stderr.write(`${issue.rule}: ${issue.file ?? "command"} ${issue.detail}\n`);
  }
  for (const run of commandRuns.filter((entry) => entry.status !== "passed")) {
    process.stderr.write(
      [run.label, run.stderrPreview, run.stdoutPreview].filter(Boolean).join("\n"),
    );
    process.stderr.write("\n");
  }
  process.exitCode = 1;
}
