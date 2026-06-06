import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-h2-agent-os-desktop-release-ops-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "desktop-snapshot-agent-os-release-gate",
    path: "apps/director-desktop/src/desktop-system-handlers.js",
    needles: [
      "inspectAgentOsReleaseGateAssets(workspace.root)",
      "agentOsReleaseGate",
      '"director-agent-os-all-gate-latest.json"',
      '"director.desktop.agent-os-release-gate.v1"',
      '"real-desktop-device-release-smoke"',
      '"real-weixin-device-release-smoke"',
      '"live-external-provider-account-smoke"',
      '"live-user-memory-dataset-sweep"',
      "normalizeAgentOsReleaseGateReport",
      "normalizeAgentOsReleaseGateSkippedCheck",
    ],
  },
  {
    id: "desktop-review-agent-os-release-ops-panel",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "createAgentOsReleaseGateOpsPanel(review?.agentOsReleaseGate)",
      "function createAgentOsReleaseGateOpsPanel",
      "Agent OS 发布门禁",
      "CI-safe",
      "smoke",
      "synthetic",
      "real-provider",
      "real-data",
      "missing-auth",
      "missing-local-service",
      "provider-disabled",
      "unsafe-environment",
      "formatAgentOsReleaseGateSkipReason",
    ],
  },
  {
    id: "desktop-review-agent-os-release-structure-test",
    path: "apps/director-desktop/src/app-structure.test.js",
    needles: [
      "createAgentOsReleaseGateOpsPanel",
      "formatAgentOsReleaseGateSkipReason",
      "Agent OS 发布门禁",
      ".agent-os-release-gate-panel",
      ".agent-os-release-gate-tier",
    ],
  },
  {
    id: "desktop-snapshot-agent-os-release-test",
    path: "apps/director-desktop/src/desktop-system-handlers.test.js",
    needles: [
      "agentOsReleaseGate",
      "director-agent-os-all-gate-latest.json",
      "real-desktop-device-release-smoke",
      "live-user-memory-dataset-sweep",
      "unsafe-environment",
    ],
  },
  {
    id: "desktop-agent-os-release-styles",
    path: "apps/director-desktop/src/styles.css",
    needles: [
      ".agent-os-release-gate-panel",
      ".agent-os-release-gate-body",
      ".agent-os-release-gate-tier-grid",
      ".agent-os-release-gate-checklist",
    ],
  },
];

const requiredArtifactCoverage = [
  {
    id: "agent-os-all-latest-artifact",
    path: "benchmarks/results/director-agent-os-all-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-agent-os-all-gate",
      (report) => report?.summary?.status === "passed",
      (report) => report?.summary?.tiers === 4,
      (report) => report?.summary?.skippedChecks === 7,
      (report) => new Set((report?.tiers ?? []).map((tier) => tier.id)).has("smoke"),
      (report) => new Set((report?.tiers ?? []).map((tier) => tier.id)).has("synthetic"),
      (report) => new Set((report?.tiers ?? []).map((tier) => tier.id)).has("real-provider"),
      (report) => new Set((report?.tiers ?? []).map((tier) => tier.id)).has("real-data"),
      (report) =>
        (report?.tiers ?? [])
          .flatMap((tier) => tier.skippedChecks ?? [])
          .some(
            (check) =>
              check.id === "live-user-memory-dataset-sweep" &&
              check.skipReason === "unsafe-environment",
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
    note: "Phase H.2 proves the desktop Review/Ops surface reads the latest Agent OS aggregate release gate and exposes tier matrix plus live-only skipped checks as an operator checklist.",
  },
  sourceCoverage,
  artifactCoverage,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS desktop release ops gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Source coverage: ${report.summary.sourceCoveragePassed}/${report.summary.sourceCoverage}, artifact coverage: ${report.summary.artifactCoveragePassed}/${report.summary.artifactCoverage}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  fail("Director Agent OS desktop release ops gate failed.", failures.join("\n"));
}
