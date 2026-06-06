import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-gnext-agent-os-memory-eval-dashboard-maintenance-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "desktop-snapshot-memory-eval-dashboard",
    path: "apps/director-desktop/src/desktop-system-handlers.js",
    needles: [
      "createAgentOsMemoryEvalDashboardAssets(agentOsMemoryEval, agentOsMemorySweepSafety)",
      "agentOsMemoryEvalDashboard",
      '"director.desktop.agent-os-memory-eval-dashboard.v1"',
      "memoryEvalTrend",
      "maintenanceDueActions",
      "maintenance-due",
      "recall-degradation-watch",
      "dataset-loader-gate",
      "canReadUserData: false",
      "localOnly: true",
      "nextRecommendedCommand",
      "bench:director-agent-os-memory-dataset-loader-anonymization",
    ],
  },
  {
    id: "desktop-review-memory-eval-dashboard-panel",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "createAgentOsMemoryEvalDashboardOpsPanel(review?.agentOsMemoryEvalDashboard)",
      "function createAgentOsMemoryEvalDashboardOpsPanel",
      "Agent OS 记忆评估 dashboard",
      "memoryEvalTrend",
      "maintenance-due actions",
      "recall degradation",
      "dataset loader gate",
      "local-only dashboard",
      "createAgentOsMemoryEvalDashboardTrendList",
      "createAgentOsMemoryEvalMaintenanceDueList",
    ],
  },
  {
    id: "desktop-review-memory-eval-dashboard-structure-test",
    path: "apps/director-desktop/src/app-structure.test.js",
    needles: [
      "createAgentOsMemoryEvalDashboardOpsPanel",
      "createAgentOsMemoryEvalDashboardTrendList",
      "createAgentOsMemoryEvalMaintenanceDueList",
      "Agent OS 记忆评估 dashboard",
      ".agent-os-memory-eval-dashboard-panel",
      ".agent-os-memory-eval-dashboard-trend",
      ".agent-os-memory-eval-dashboard-maintenance",
    ],
  },
  {
    id: "desktop-snapshot-memory-eval-dashboard-test",
    path: "apps/director-desktop/src/desktop-system-handlers.test.js",
    needles: [
      "agentOsMemoryEvalDashboard",
      "director.desktop.agent-os-memory-eval-dashboard.v1",
      "memoryEvalTrend",
      "maintenanceDueActions",
      "recall-degradation-watch",
      "dataset-loader-gate",
      "canReadUserData",
      "nextRecommendedCommand",
    ],
  },
  {
    id: "desktop-memory-eval-dashboard-styles",
    path: "apps/director-desktop/src/styles.css",
    needles: [
      ".agent-os-memory-eval-dashboard-panel",
      ".agent-os-memory-eval-dashboard-body",
      ".agent-os-memory-eval-dashboard-trend",
      ".agent-os-memory-eval-dashboard-maintenance",
      ".agent-os-memory-eval-dashboard-action",
    ],
  },
  {
    id: "dashboard-release-registration",
    path: "benchmarks/scripts/director-agent-os-all-gate.mjs",
    needles: ["director-phase-gnext-agent-os-memory-eval-dashboard-maintenance-gate"],
  },
];

const requiredArtifactCoverage = [
  {
    id: "dataset-loader-gate-latest-artifact",
    path: "benchmarks/results/director-phase-gnext-agent-os-memory-dataset-loader-anonymization-gate-latest.json",
    checks: [
      (report) =>
        report?.suiteId ===
        "director-phase-gnext-agent-os-memory-dataset-loader-anonymization-gate",
      (report) => report?.summary?.status === "passed",
      (report) => report?.behaviorCoverage?.readySummary?.canReadUserData === false,
      (report) => report?.behaviorCoverage?.readySummary?.safetyEnvelope?.allowNetwork === false,
      (report) => report?.behaviorCoverage?.readySummary?.safetyEnvelope?.dryRunOnly === true,
      (report) => report?.behaviorCoverage?.readySummary?.anonymization?.rawContentStored === false,
    ],
  },
  {
    id: "mempalace-real-eval-latest-artifact",
    path: "benchmarks/results/director-agent-os-mempalace-real-eval-fixture-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-agent-os-mempalace-real-eval-fixture-gate",
      (report) => report?.summary?.status === "passed",
      (report) => report?.summary?.qualityAverages?.recallAtK === 1,
      (report) => report?.summary?.qualityAverages?.ndcgAtK === 1,
      (report) => report?.diagnosticThresholds?.status === "failed",
    ],
  },
];

function readText(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function evaluateSourceCoverage() {
  return requiredSourceCoverage.map((item) => {
    let text = "";
    let sourceLoadError = null;
    try {
      text = readText(item.path);
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
      missingNeedles,
      ...(sourceLoadError === null ? {} : { sourceLoadError }),
    };
  });
}

function evaluateArtifactCoverage() {
  return requiredArtifactCoverage.map((item) => {
    let report = null;
    let sourceLoadError = null;
    try {
      report = JSON.parse(readText(item.path));
    } catch (error) {
      sourceLoadError = error instanceof Error ? error.message : String(error);
    }
    const failedChecks =
      sourceLoadError === null
        ? item.checks
            .map((check, index) => ({ index, passed: check(report) }))
            .filter((check) => !check.passed)
            .map((check) => `check-${check.index}`)
        : item.checks.map((_, index) => `check-${index}`);
    return {
      id: item.id,
      path: item.path,
      status: failedChecks.length === 0 ? "passed" : "failed",
      failedChecks,
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

const sourceCoverage = evaluateSourceCoverage();
const artifactCoverage = evaluateArtifactCoverage();
const failedSourceCoverage = sourceCoverage.filter((result) => result.status !== "passed");
const failedArtifactCoverage = artifactCoverage.filter((result) => result.status !== "passed");
const failures = [
  ...failedSourceCoverage.map(
    (result) => `${result.id} missing ${result.missingNeedles.join(", ")} in ${result.path}`,
  ),
  ...failedArtifactCoverage.map(
    (result) => `${result.id} failed ${result.failedChecks.join(", ")} in ${result.path}`,
  ),
];

const report = {
  suiteId,
  generatedAt: new Date().toISOString(),
  summary: {
    status: failures.length === 0 ? "passed" : "failed",
    sourceCoverage: sourceCoverage.length,
    sourceCoveragePassed: sourceCoverage.length - failedSourceCoverage.length,
    artifactCoverage: artifactCoverage.length,
    artifactCoveragePassed: artifactCoverage.length - failedArtifactCoverage.length,
    failed: failures.length,
    note: "G.next proves the desktop Review/Ops memory eval dashboard surfaces local-only recall trends, dataset-loader safety state, and maintenance-due actions without reading live user memory datasets.",
  },
  sourceCoverage,
  artifactCoverage,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS memory eval dashboard maintenance gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Source coverage: ${report.summary.sourceCoveragePassed}/${report.summary.sourceCoverage}, artifact coverage: ${report.summary.artifactCoveragePassed}/${report.summary.artifactCoverage}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  fail("Director Agent OS memory eval dashboard maintenance gate failed.", failures.join("\n"));
}
