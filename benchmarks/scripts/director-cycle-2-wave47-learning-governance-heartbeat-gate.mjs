import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const pnpmBin = process.env.npm_execpath ?? (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-cycle-2-wave47-learning-governance-heartbeat-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const cases = [
  {
    id: "cycle2_wave47_director_knowledge_heartbeat",
    label:
      "director-knowledge heartbeat surfaces daily learning governance backlog as maintenance-due",
    args: [
      "--filter",
      "@hotflow/director-knowledge",
      "exec",
      "vitest",
      "run",
      "test/heartbeat.test.ts",
    ],
  },
  {
    id: "cycle2_wave47_director_knowledge_maintenance",
    label: "director-knowledge maintenance keeps learning governance diagnostics explicit",
    args: [
      "--filter",
      "@hotflow/director-knowledge",
      "exec",
      "vitest",
      "run",
      "test/maintenance.test.ts",
      "--testNamePattern",
      "surfaces learning governance diagnostics",
    ],
  },
  {
    id: "cycle2_wave47_director_knowledge_build",
    label: "director-knowledge build keeps heartbeat governance contract typed",
    args: ["--filter", "@hotflow/director-knowledge", "build"],
  },
  {
    id: "cycle2_wave47_targeted_format",
    label: "targeted Biome check covers learning governance heartbeat gate files",
    args: [
      "exec",
      "biome",
      "check",
      "packages/director-knowledge/src/heartbeat.ts",
      "packages/director-knowledge/test/heartbeat.test.ts",
      "benchmarks/package.json",
      "benchmarks/scripts/wave-suite-manifest.mjs",
      "benchmarks/scripts/director-cycle-2-wave47-learning-governance-heartbeat-gate.mjs",
    ],
  },
];

const requiredCoverage = [
  {
    id: "heartbeat-maintenance-due-governance",
    path: "packages/director-knowledge/test/heartbeat.test.ts",
    needles: [
      "surfaces learning governance backlogs as maintenance due during heartbeat",
      'kind === "maintenance-due"',
      "accepted backlog 9",
      "pending backlog 21",
      "missing recall eval 1",
      "learning-governance://published-knowledge-missing-recall-eval/count/1",
    ],
  },
  {
    id: "heartbeat-implementation-governance",
    path: "packages/director-knowledge/src/heartbeat.ts",
    needles: [
      "learningGovernance.summary.recommendedActions",
      "formatGovernanceEvidenceRef",
      "learning-governance://",
      "knowledgeDir: workspace.knowledge",
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

function evaluateCoverage() {
  return requiredCoverage.map((item) => {
    let text = "";
    let sourceLoadError = null;
    try {
      text = readFileSync(resolve(repoRoot, item.path), "utf8");
    } catch (error) {
      sourceLoadError = error instanceof Error ? error.message : String(error);
    }
    const missingNeedles =
      sourceLoadError === null
        ? item.needles.filter((needle) => !text.includes(needle))
        : item.needles;
    return {
      id: item.id,
      path: item.path,
      status: missingNeedles.length === 0 ? "passed" : "failed",
      needles: item.needles,
      missingNeedles,
      ...(sourceLoadError === null ? {} : { sourceLoadError }),
    };
  });
}

function fail(message, details) {
  process.stderr.write(`${message}\n`);
  if (details) {
    process.stderr.write(`${details}\n`);
  }
  process.exit(1);
}

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
const coverageResults = evaluateCoverage();
const failedCases = caseResults.filter((result) => result.status !== "passed");
const failedCoverage = coverageResults.filter((result) => result.status !== "passed");
const failures = [
  ...failedCases.map((result) => `${result.id}: ${result.failures.join(" | ")}`),
  ...failedCoverage.map(
    (result) => `${result.id} missing ${result.missingNeedles.join(", ")} in ${result.path}`,
  ),
];

const report = {
  suiteId,
  generatedAt: new Date().toISOString(),
  summary: {
    status: failures.length === 0 ? "passed" : "failed",
    total: caseResults.length,
    passed: caseResults.length - failedCases.length,
    failed: failures.length,
    coverageItems: coverageResults.length,
    coverageFailures: failedCoverage.length,
    note: "This gate proves daily learning governance backlog and missing recall eval evidence surface through heartbeat maintenance-due, without applying cleanup.",
  },
  caseResults,
  coverageResults,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Cycle 2 Wave 47 learning governance heartbeat gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Coverage: ${coverageResults.length - failedCoverage.length}/${coverageResults.length}, case failures: ${failedCases.length}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  fail("Director Cycle 2 Wave 47 learning governance heartbeat gate failed.", failures.join("\n"));
}
