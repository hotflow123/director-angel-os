import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-g2-agent-os-memory-eval-ops-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "desktop-snapshot-agent-os-memory-eval",
    path: "apps/director-desktop/src/desktop-system-handlers.js",
    needles: [
      "inspectAgentOsMemoryEvalAssets(workspace.root)",
      "agentOsMemoryEval",
      '"director-agent-os-mempalace-real-eval-fixture-gate-latest.json"',
      '"director.desktop.agent-os-memory-eval.v1"',
      "normalizeAgentOsMemoryEvalReport",
      "normalizeAgentOsMemoryEvalDiagnosticFailure",
      "qualityAverages",
      "diagnosticThresholds",
      "localOnly",
    ],
  },
  {
    id: "desktop-review-agent-os-memory-eval-ops-panel",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "createAgentOsMemoryEvalOpsPanel(review?.agentOsMemoryEval)",
      "function createAgentOsMemoryEvalOpsPanel",
      "Agent OS 记忆评估",
      "local-only fixture",
      "recall@k",
      "NDCG@k",
      "verbatim",
      "provenance",
      "diagnostic",
      "formatAgentOsMemoryEvalMetric",
      "createAgentOsMemoryEvalDiagnosticList",
    ],
  },
  {
    id: "desktop-review-agent-os-memory-eval-structure-test",
    path: "apps/director-desktop/src/app-structure.test.js",
    needles: [
      "createAgentOsMemoryEvalOpsPanel",
      "formatAgentOsMemoryEvalMetric",
      "Agent OS 记忆评估",
      ".agent-os-memory-eval-panel",
      ".agent-os-memory-eval-metrics",
      ".agent-os-memory-eval-diagnostics",
    ],
  },
  {
    id: "desktop-snapshot-agent-os-memory-eval-test",
    path: "apps/director-desktop/src/desktop-system-handlers.test.js",
    needles: [
      "agentOsMemoryEval",
      "director-agent-os-mempalace-real-eval-fixture-gate-latest.json",
      "director.desktop.agent-os-memory-eval.v1",
      "local-mini-locomem-style-fixture",
      "diagnostic-missing-verbatim-provenance",
      "mempalace:drawer_required_missing",
    ],
  },
  {
    id: "desktop-agent-os-memory-eval-styles",
    path: "apps/director-desktop/src/styles.css",
    needles: [
      ".agent-os-memory-eval-panel",
      ".agent-os-memory-eval-body",
      ".agent-os-memory-eval-metrics",
      ".agent-os-memory-eval-diagnostics",
      ".agent-os-memory-eval-source",
    ],
  },
];

const requiredArtifactCoverage = [
  {
    id: "mempalace-real-eval-latest-artifact",
    path: "benchmarks/results/director-agent-os-mempalace-real-eval-fixture-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-agent-os-mempalace-real-eval-fixture-gate",
      (report) => report?.summary?.status === "passed",
      (report) => report?.summary?.qualityCaseCount === 3,
      (report) => report?.summary?.diagnosticCaseCount === 1,
      (report) => report?.source?.localOnly === true,
      (report) => report?.summary?.thresholds?.recallAtK === 0.8,
      (report) => report?.summary?.thresholds?.recallAnyAtK === 1,
      (report) => report?.summary?.thresholds?.ndcgAtK === 0.75,
      (report) => report?.summary?.thresholds?.requireVerbatimEvidence === true,
      (report) => report?.summary?.thresholds?.requireProvenanceEvidence === true,
      (report) => report?.summary?.qualityAverages?.recallAtK === 1,
      (report) => report?.summary?.qualityAverages?.ndcgAtK === 1,
      (report) => report?.diagnosticThresholds?.status === "failed",
      (report) =>
        (report?.diagnosticThresholds?.failures ?? []).some((failure) =>
          String(failure).includes("missing provenance"),
        ),
      (report) =>
        (report?.diagnosticReport?.results ?? []).some(
          (result) => result.queryId === "diagnostic-missing-verbatim-provenance",
        ),
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
    note: "Phase G.2 proves the desktop Review/Ops surface reads the latest local MemPalace fixture eval report and exposes thresholds, quality averages, and diagnostic failures without reading live user datasets.",
  },
  sourceCoverage,
  artifactCoverage,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS memory eval ops gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Source coverage: ${report.summary.sourceCoveragePassed}/${report.summary.sourceCoverage}, artifact coverage: ${report.summary.artifactCoveragePassed}/${report.summary.artifactCoverage}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  fail("Director Agent OS memory eval ops gate failed.", failures.join("\n"));
}
