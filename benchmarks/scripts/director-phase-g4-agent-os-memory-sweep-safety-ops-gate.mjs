import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-g4-agent-os-memory-sweep-safety-ops-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "desktop-snapshot-memory-sweep-safety",
    path: "apps/director-desktop/src/desktop-system-handlers.js",
    needles: [
      "createAgentOsMemorySweepSafetyAssets()",
      "agentOsMemorySweepSafety",
      "planMempalaceLiveMemoryEvalSweep",
      '"director.desktop.agent-os-memory-sweep-safety.v1"',
      "live-user-memory-eval",
      "operator-approval-required",
      "anonymization-required",
      "raw-content-storage-forbidden",
      "network-disabled-required",
      "canReadUserData",
      "normalizeAgentOsMemorySweepSafetyPlan",
    ],
  },
  {
    id: "desktop-review-memory-sweep-safety-panel",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "createAgentOsMemorySweepSafetyOpsPanel(review?.agentOsMemorySweepSafety)",
      "function createAgentOsMemorySweepSafetyOpsPanel",
      "Agent OS 记忆评测安全预检",
      "live-user-memory",
      "blocked reasons",
      "operator approval",
      "anonymization",
      "retention",
      "dry-run",
      "read-only",
      "network disabled",
      "formatAgentOsMemorySweepSafetyReason",
    ],
  },
  {
    id: "desktop-review-memory-sweep-safety-structure-test",
    path: "apps/director-desktop/src/app-structure.test.js",
    needles: [
      "createAgentOsMemorySweepSafetyOpsPanel",
      "formatAgentOsMemorySweepSafetyReason",
      "Agent OS 记忆评测安全预检",
      ".agent-os-memory-sweep-safety-panel",
      ".agent-os-memory-sweep-safety-reasons",
      ".agent-os-memory-sweep-safety-checklist",
    ],
  },
  {
    id: "desktop-snapshot-memory-sweep-safety-test",
    path: "apps/director-desktop/src/desktop-system-handlers.test.js",
    needles: [
      "agentOsMemorySweepSafety",
      "director.desktop.agent-os-memory-sweep-safety.v1",
      "live-user-memory-eval",
      "operator-approval-required",
      "raw-content-storage-forbidden",
      "canReadUserData",
      "local-fixture-sweep",
    ],
  },
  {
    id: "desktop-memory-sweep-safety-styles",
    path: "apps/director-desktop/src/styles.css",
    needles: [
      ".agent-os-memory-sweep-safety-panel",
      ".agent-os-memory-sweep-safety-body",
      ".agent-os-memory-sweep-safety-plans",
      ".agent-os-memory-sweep-safety-reasons",
      ".agent-os-memory-sweep-safety-checklist",
    ],
  },
];

const requiredArtifactCoverage = [
  {
    id: "memory-sweep-safety-latest-artifact",
    path: "benchmarks/results/director-phase-g3-agent-os-memory-sweep-safety-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-phase-g3-agent-os-memory-sweep-safety-gate",
      (report) => report?.summary?.status === "passed",
      (report) => report?.summary?.sourceCoveragePassed === 3,
      (report) => report?.summary?.behaviorCoveragePassed === 1,
      (report) => report?.behaviorCoverage?.blockedSummary?.canReadUserData === false,
      (report) => report?.behaviorCoverage?.readySummary?.canReadUserData === false,
      (report) =>
        (report?.behaviorCoverage?.blockedSummary?.reasonCodes ?? []).includes(
          "operator-approval-required",
        ),
      (report) => report?.behaviorCoverage?.readySummary?.safetyEnvelope?.allowNetwork === false,
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
    note: "Phase G.4 proves desktop Review/Ops surfaces the live memory eval safety preflight as read-only blocked/ready plans without reading live user datasets.",
  },
  sourceCoverage,
  artifactCoverage,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS memory sweep safety ops gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Source coverage: ${report.summary.sourceCoveragePassed}/${report.summary.sourceCoverage}, artifact coverage: ${report.summary.artifactCoveragePassed}/${report.summary.artifactCoverage}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  fail("Director Agent OS memory sweep safety ops gate failed.", failures.join("\n"));
}
