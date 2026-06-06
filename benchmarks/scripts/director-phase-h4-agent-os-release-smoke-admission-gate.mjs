import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-h4-agent-os-release-smoke-admission-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "desktop-snapshot-release-smoke-admission",
    path: "apps/director-desktop/src/desktop-system-handlers.js",
    needles: [
      "createAgentOsReleaseSmokeAdmissionAssets(agentOsReleaseSmokeReadiness)",
      "agentOsReleaseSmokeAdmission",
      '"director.desktop.agent-os-release-smoke-admission.v1"',
      "normalizeAgentOsReleaseSmokeAdmissionReport",
      "normalizeAgentOsReleaseSmokeAdmissionVerdict",
      "releaseSmokeAdmissionMissingSignalsForPlan",
      "operatorScope",
      "environmentIsolation",
      "auditEvidence",
      "dataPolicy",
      "admitted",
      "runnerIntentCreated",
      "executionTokenIssued",
    ],
  },
  {
    id: "desktop-review-release-smoke-admission-panel",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "createAgentOsReleaseSmokeAdmissionOpsPanel(review?.agentOsReleaseSmokeAdmission)",
      "function createAgentOsReleaseSmokeAdmissionOpsPanel",
      "Agent OS 发布 smoke 准入",
      "admission verdicts",
      "admitted=false",
      "runnerIntentCreated=false",
      "operator scope",
      "environment isolation",
      "audit evidence",
      "formatAgentOsReleaseSmokeAdmissionSignal",
    ],
  },
  {
    id: "desktop-review-release-smoke-admission-structure-test",
    path: "apps/director-desktop/src/app-structure.test.js",
    needles: [
      "createAgentOsReleaseSmokeAdmissionOpsPanel",
      "formatAgentOsReleaseSmokeAdmissionSignal",
      "Agent OS 发布 smoke 准入",
      ".agent-os-release-smoke-admission-panel",
      ".agent-os-release-smoke-admission-verdict",
      ".agent-os-release-smoke-admission-signals",
    ],
  },
  {
    id: "desktop-snapshot-release-smoke-admission-test",
    path: "apps/director-desktop/src/desktop-system-handlers.test.js",
    needles: [
      "agentOsReleaseSmokeAdmission",
      "director.desktop.agent-os-release-smoke-admission.v1",
      "real-desktop-device-release-smoke",
      "live-browser-authenticated-smoke",
      "live-user-memory-dataset-sweep",
      "admitted: false",
      "runnerIntentCreated: false",
      "executionTokenIssued: false",
    ],
  },
  {
    id: "desktop-release-smoke-admission-styles",
    path: "apps/director-desktop/src/styles.css",
    needles: [
      ".agent-os-release-smoke-admission-panel",
      ".agent-os-release-smoke-admission-body",
      ".agent-os-release-smoke-admission-verdicts",
      ".agent-os-release-smoke-admission-verdict",
      ".agent-os-release-smoke-admission-signals",
    ],
  },
];

const requiredArtifactCoverage = [
  {
    id: "agent-os-all-latest-release-smoke-admission-artifact",
    path: "benchmarks/results/director-agent-os-all-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-agent-os-all-gate",
      (report) =>
        report?.releaseSmokeAdmission?.schemaVersion ===
        "director.agent-os.release-smoke-admission.v1",
      (report) => report?.releaseSmokeAdmission?.summary?.verdictCount === 7,
      (report) => report?.releaseSmokeAdmission?.summary?.blockedCount === 7,
      (report) => report?.releaseSmokeAdmission?.summary?.admittedCount === 0,
      (report) => report?.releaseSmokeAdmission?.summary?.runnerIntentCreatedCount === 0,
      (report) => report?.releaseSmokeAdmission?.summary?.executionTokenIssuedCount === 0,
      (report) =>
        (report?.releaseSmokeAdmission?.verdicts ?? []).some(
          (verdict) =>
            verdict.id === "live-user-memory-dataset-sweep" &&
            verdict.admitted === false &&
            (verdict.missingSignals ?? []).includes("operator-scope") &&
            (verdict.missingSignals ?? []).includes("data-policy"),
        ),
      (report) =>
        (report?.releaseSmokeAdmission?.verdicts ?? []).every(
          (verdict) =>
            verdict.runnerIntentCreated === false && verdict.executionTokenIssued === false,
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
    note: "Phase H.4 proves live-only release smoke readiness plans remain blocked by explicit admission verdicts until operator scope, auth, environment isolation, audit evidence, and data policy are satisfied.",
  },
  sourceCoverage,
  artifactCoverage,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS release smoke admission gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Source coverage: ${report.summary.sourceCoveragePassed}/${report.summary.sourceCoverage}, artifact coverage: ${report.summary.artifactCoveragePassed}/${report.summary.artifactCoverage}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  fail("Director Agent OS release smoke admission gate failed.", failures.join("\n"));
}
