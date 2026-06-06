import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-fnext-agent-os-executable-recovery-workflow-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const requiredSourceCoverage = [
  {
    id: "worker-jobs-scheduler-recovery-source",
    path: "apps/worker-jobs/src/scheduler-recovery.ts",
    needles: [
      "runSchedulerRecoveryJob",
      'workflowMode: "bounded-local-recovery"',
      "projectSubagentSchedulerRecoveryPlanFromTaskState",
      "confirmCancelObservedDrift",
      "requires-confirmation",
      "cancelled-queued-subagents",
      "setDelegationStatus",
      "remoteWriteExecutionAllowed: false",
      "processRunnerAllowed: false",
      "destructiveActionsRequireConfirmation: true",
    ],
  },
  {
    id: "worker-jobs-scheduler-recovery-cli-source",
    path: "apps/worker-jobs/src/main.ts",
    needles: [
      "runSchedulerRecoveryJob",
      "ParsedSchedulerRecoveryCommand",
      "scheduler-recovery",
      "--action-id",
      "--confirm-cancel-observed-drift",
      "parseSchedulerRecoveryCommand",
    ],
  },
  {
    id: "worker-jobs-scheduler-recovery-bootstrap-source",
    path: "apps/worker-jobs/src/bootstrap.ts",
    needles: ["runSchedulerRecoveryJob", "schedulerRecovery"],
  },
  {
    id: "tasks-core-cancelled-drift-recovery-source",
    path: "packages/tasks-core/src/subagent-runtime.ts",
    needles: [
      "activeConflictRecords",
      'entry.status !== "cancelled"',
      'record.status === "queued" || record.status === "running"',
    ],
  },
  {
    id: "worker-jobs-scheduler-recovery-test-source",
    path: "apps/worker-jobs/tests/delegation-flow.test.ts",
    needles: [
      "scheduler-recovery keeps running conflicts blocked and requires confirmation for observed drift",
      "scheduler-recovery cancels observed drift follow-up only after operator confirmation",
      "--confirm-cancel-observed-drift",
      "d_gamma_followup",
      "cancelled-queued-subagents",
    ],
  },
  {
    id: "tasks-core-cancelled-drift-test-source",
    path: "packages/tasks-core/src/subagent-runtime.test.ts",
    needles: [
      "omits cancelled observed-drift follow-ups from scheduler recovery recommendations",
      "delegate_gamma_cancelled",
      "canRecover: false",
    ],
  },
];

const forbiddenSourceCoverage = [
  {
    id: "scheduler-recovery-no-process-runner",
    path: "apps/worker-jobs/src/scheduler-recovery.ts",
    forbidden: ["child_process", "spawn(", "exec("],
  },
  {
    id: "scheduler-recovery-no-direct-claim-or-dispatch",
    path: "apps/worker-jobs/src/scheduler-recovery.ts",
    forbidden: ["claimDelegation(", "runDelegationJob", "runSchedulerExecutorJob"],
  },
  {
    id: "scheduler-recovery-no-remote-write-language",
    path: "apps/worker-jobs/src/scheduler-recovery.ts",
    forbidden: ["remoteWriteExecutionAllowed: true", "remoteExecution", "remote-runner"],
  },
];

const commandChecks = [
  {
    label: "tasks-core scheduler recovery focused tests",
    args: [
      "--filter",
      "@hotflow/tasks-core",
      "test",
      "--",
      "src/subagent-runtime.test.ts",
      "-t",
      "cancelled observed-drift|read-only scheduler conflict recovery",
    ],
  },
  {
    label: "tasks-core build for worker-jobs package boundary",
    args: ["--filter", "@hotflow/tasks-core", "build"],
  },
  {
    label: "worker-jobs scheduler recovery focused tests",
    args: [
      "--filter",
      "@hotflow/worker-jobs",
      "test",
      "--",
      "tests/delegation-flow.test.ts",
      "-t",
      "scheduler-recovery",
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
    recoveryWorkflow: {
      mode: "bounded-local-recovery",
      dryRunDefault: true,
      destructiveActionsRequireConfirmation: true,
      remoteWriteExecutionAllowed: false,
      processRunnerAllowed: false,
    },
  },
  requiredSourceCoverage,
  forbiddenSourceCoverage,
  commandRuns,
  issues,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS executable recovery workflow gate completed: ${report.summary.status}\n`,
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
