import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-h3-agent-os-release-smoke-readiness-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "desktop-snapshot-release-smoke-readiness",
    path: "apps/director-desktop/src/desktop-system-handlers.js",
    needles: [
      "createAgentOsReleaseSmokeReadinessAssets(agentOsReleaseGate, agentOsMemorySweepSafety)",
      "agentOsReleaseSmokeReadiness",
      '"director.desktop.agent-os-release-smoke-readiness.v1"',
      "normalizeAgentOsReleaseSmokeReadinessReport",
      "normalizeAgentOsReleaseSmokeReadinessPlan",
      '"real-desktop-device-release-smoke"',
      '"real-weixin-device-release-smoke"',
      '"live-external-provider-account-smoke"',
      '"live-browser-authenticated-smoke"',
      '"live-user-memory-dataset-sweep"',
      "requiresOperatorAction",
      "canExecuteLiveCheck",
      "liveRunnerEnabled",
    ],
  },
  {
    id: "desktop-review-release-smoke-readiness-panel",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "createAgentOsReleaseSmokeReadinessOpsPanel(review?.agentOsReleaseSmokeReadiness)",
      "function createAgentOsReleaseSmokeReadinessOpsPanel",
      "Agent OS 发布 smoke 预检",
      "readiness plans",
      "canExecuteLiveCheck=false",
      "operator action",
      "missing-local-service",
      "missing-auth",
      "provider-disabled",
      "unsafe-environment",
      "formatAgentOsReleaseSmokeReadinessRequirement",
    ],
  },
  {
    id: "desktop-review-release-smoke-readiness-structure-test",
    path: "apps/director-desktop/src/app-structure.test.js",
    needles: [
      "createAgentOsReleaseSmokeReadinessOpsPanel",
      "formatAgentOsReleaseSmokeReadinessRequirement",
      "Agent OS 发布 smoke 预检",
      ".agent-os-release-smoke-readiness-panel",
      ".agent-os-release-smoke-readiness-plan",
      ".agent-os-release-smoke-readiness-requirements",
    ],
  },
  {
    id: "desktop-snapshot-release-smoke-readiness-test",
    path: "apps/director-desktop/src/desktop-system-handlers.test.js",
    needles: [
      "agentOsReleaseSmokeReadiness",
      "director.desktop.agent-os-release-smoke-readiness.v1",
      "real-desktop-device-release-smoke",
      "live-browser-authenticated-smoke",
      "live-user-memory-dataset-sweep",
      "canExecuteLiveCheck: false",
      "liveRunnerEnabled: false",
    ],
  },
  {
    id: "desktop-release-smoke-readiness-styles",
    path: "apps/director-desktop/src/styles.css",
    needles: [
      ".agent-os-release-smoke-readiness-panel",
      ".agent-os-release-smoke-readiness-body",
      ".agent-os-release-smoke-readiness-plans",
      ".agent-os-release-smoke-readiness-plan",
      ".agent-os-release-smoke-readiness-requirements",
    ],
  },
];

const requiredArtifactCoverage = [
  {
    id: "agent-os-all-latest-release-smoke-readiness-artifact",
    path: "benchmarks/results/director-agent-os-all-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-agent-os-all-gate",
      (report) =>
        report?.releaseSmokeReadiness?.schemaVersion ===
        "director.agent-os.release-smoke-readiness.v1",
      (report) => report?.releaseSmokeReadiness?.summary?.planCount === 7,
      (report) => report?.releaseSmokeReadiness?.summary?.blockedCount === 7,
      (report) => report?.releaseSmokeReadiness?.summary?.canExecuteLiveCheckCount === 0,
      (report) =>
        (report?.releaseSmokeReadiness?.plans ?? []).some(
          (plan) =>
            plan.id === "live-user-memory-dataset-sweep" &&
            plan.status === "blocked" &&
            plan.canExecuteLiveCheck === false &&
            (plan.requirements ?? []).includes("operator-approval"),
        ),
      (report) =>
        (report?.releaseSmokeReadiness?.plans ?? []).some(
          (plan) =>
            plan.id === "live-browser-authenticated-smoke" &&
            plan.status === "blocked" &&
            (plan.requirements ?? []).includes("browser-auth-profile"),
        ),
      (report) =>
        (report?.releaseSmokeReadiness?.plans ?? []).every(
          (plan) => plan.liveRunnerEnabled === false,
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
    note: "Phase H.3 proves live-only release smoke checks are converted into read-only readiness plans before any real desktop, Weixin, provider, browser auth, or user-memory smoke can run.",
  },
  sourceCoverage,
  artifactCoverage,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS release smoke readiness gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Source coverage: ${report.summary.sourceCoveragePassed}/${report.summary.sourceCoverage}, artifact coverage: ${report.summary.artifactCoveragePassed}/${report.summary.artifactCoverage}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  fail("Director Agent OS release smoke readiness gate failed.", failures.join("\n"));
}
