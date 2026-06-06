import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const pnpmBin = process.env.npm_execpath ?? (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-cycle-2-wave48-memory-governance-ops-panel-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const cases = [
  {
    id: "cycle2_wave48_desktop_review_structure",
    label: "director-desktop review surfaces learning governance as an ops panel",
    args: [
      "--filter",
      "@hotflow/director-desktop",
      "exec",
      "vitest",
      "run",
      "src/app-structure.test.js",
      "--testNamePattern",
      "running review|run and report details|styles review",
    ],
  },
  {
    id: "cycle2_wave48_desktop_lint",
    label: "director-desktop lint keeps memory governance review code syntax-valid",
    args: ["--filter", "@hotflow/director-desktop", "lint"],
  },
  {
    id: "cycle2_wave48_targeted_format",
    label: "targeted Biome check covers memory governance ops panel benchmark files",
    args: [
      "exec",
      "biome",
      "check",
      "benchmarks/package.json",
      "benchmarks/scripts/wave-suite-manifest.mjs",
      "benchmarks/scripts/director-cycle-2-wave48-memory-governance-ops-panel-gate.mjs",
    ],
  },
];

const requiredCoverage = [
  {
    id: "desktop-review-memory-governance-panel",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "createReviewMemoryGovernancePanel(review)",
      "function summarizeLearningGovernanceHeartbeatItems",
      "function parseLearningGovernanceEvidenceRefs",
      'panel.className = "review-memory-governance-panel"',
      'createMetricBlock("已接受经验积压"',
      'createMetricBlock("待审经验积压"',
      'createMetricBlock("缺召回评测知识"',
      "DESKTOP_ACTIONS.MAINTENANCE_PREVIEW",
      "DESKTOP_ACTIONS.MAINTENANCE_APPLY",
      '"maintenance-due": "心跳：记忆治理维护"',
      'event.kind === "maintenance-due"',
      'target.kind === "learning-governance"',
    ],
  },
  {
    id: "desktop-heartbeat-learning-governance-target",
    path: "apps/director-desktop/src/desktop-system-handlers.js",
    needles: [
      'ref.startsWith("learning-governance://")',
      'kind: "learning-governance"',
      "readFiniteNumber(Number(match[2]))",
    ],
  },
  {
    id: "desktop-review-memory-governance-structure-test",
    path: "apps/director-desktop/src/app-structure.test.js",
    needles: [
      "createReviewMemoryGovernancePanel",
      "summarizeLearningGovernanceHeartbeatItems",
      "parseLearningGovernanceEvidenceRefs",
      '"记忆治理"',
      '"maintenance-due": "心跳：记忆治理维护"',
      ".review-memory-governance-panel",
    ],
  },
  {
    id: "desktop-review-memory-governance-styles",
    path: "apps/director-desktop/src/styles.css",
    needles: [
      ".review-memory-governance-panel",
      ".review-memory-governance-body",
      ".review-memory-governance-latest",
      ".review-memory-governance-actions",
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
    note: "This gate proves Wave47 learning governance heartbeat evidence now reaches a desktop review ops panel with direct maintenance controls.",
  },
  caseResults,
  coverageResults,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Cycle 2 Wave 48 memory governance ops panel gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Coverage: ${coverageResults.length - failedCoverage.length}/${coverageResults.length}, case failures: ${failedCases.length}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  fail("Director Cycle 2 Wave 48 memory governance ops panel gate failed.", failures.join("\n"));
}
