import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-h5-agent-os-release-smoke-execution-preflight-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "desktop-snapshot-release-smoke-execution-preflight",
    path: "apps/director-desktop/src/desktop-system-handlers.js",
    needles: [
      "createAgentOsReleaseSmokeExecutionPreflightAssets(agentOsReleaseSmokeAdmission)",
      "agentOsReleaseSmokeExecutionPreflight",
      '"director.desktop.agent-os-release-smoke-execution-preflight.v1"',
      "normalizeAgentOsReleaseSmokeExecutionPreflightReport",
      "normalizeAgentOsReleaseSmokeExecutionPreflightPacket",
      "releaseSmokeExecutionEvidenceForVerdict",
      "operatorScopeEvidence",
      "environmentIsolationEvidence",
      "auditArtifact",
      "executionBlockedReason",
      "executionIntentCreated",
      "liveRunnerStarted",
    ],
  },
  {
    id: "desktop-review-release-smoke-execution-preflight-panel",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "createAgentOsReleaseSmokeExecutionPreflightOpsPanel(review?.agentOsReleaseSmokeExecutionPreflight)",
      "function createAgentOsReleaseSmokeExecutionPreflightOpsPanel",
      "Agent OS 发布 smoke 执行预检",
      "execution preflight packets",
      "executionIntentCreated=false",
      "liveRunnerStarted=false",
      "audit artifact",
      "operator scope evidence",
      "formatAgentOsReleaseSmokeExecutionEvidence",
    ],
  },
  {
    id: "desktop-review-release-smoke-execution-preflight-structure-test",
    path: "apps/director-desktop/src/app-structure.test.js",
    needles: [
      "createAgentOsReleaseSmokeExecutionPreflightOpsPanel",
      "formatAgentOsReleaseSmokeExecutionEvidence",
      "Agent OS 发布 smoke 执行预检",
      ".agent-os-release-smoke-execution-preflight-panel",
      ".agent-os-release-smoke-execution-preflight-packet",
      ".agent-os-release-smoke-execution-preflight-evidence",
    ],
  },
  {
    id: "desktop-snapshot-release-smoke-execution-preflight-test",
    path: "apps/director-desktop/src/desktop-system-handlers.test.js",
    needles: [
      "agentOsReleaseSmokeExecutionPreflight",
      "director.desktop.agent-os-release-smoke-execution-preflight.v1",
      "real-desktop-device-release-smoke",
      "live-external-provider-account-smoke",
      "live-user-memory-dataset-sweep",
      "executionIntentCreated: false",
      "liveRunnerStarted: false",
      'executionBlockedReason: "admission-blocked"',
    ],
  },
  {
    id: "desktop-release-smoke-execution-preflight-styles",
    path: "apps/director-desktop/src/styles.css",
    needles: [
      ".agent-os-release-smoke-execution-preflight-panel",
      ".agent-os-release-smoke-execution-preflight-body",
      ".agent-os-release-smoke-execution-preflight-packets",
      ".agent-os-release-smoke-execution-preflight-packet",
      ".agent-os-release-smoke-execution-preflight-evidence",
    ],
  },
];

const requiredArtifactCoverage = [
  {
    id: "agent-os-all-latest-release-smoke-execution-preflight-artifact",
    path: "benchmarks/results/director-agent-os-all-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-agent-os-all-gate",
      (report) =>
        report?.releaseSmokeExecutionPreflight?.schemaVersion ===
        "director.agent-os.release-smoke-execution-preflight.v1",
      (report) => report?.releaseSmokeExecutionPreflight?.summary?.packetCount === 7,
      (report) => report?.releaseSmokeExecutionPreflight?.summary?.blockedCount === 7,
      (report) => report?.releaseSmokeExecutionPreflight?.summary?.readyToExecuteCount === 0,
      (report) =>
        report?.releaseSmokeExecutionPreflight?.summary?.executionIntentCreatedCount === 0,
      (report) => report?.releaseSmokeExecutionPreflight?.summary?.liveRunnerStartedCount === 0,
      (report) =>
        (report?.releaseSmokeExecutionPreflight?.packets ?? []).some(
          (packet) =>
            packet.id === "live-user-memory-dataset-sweep" &&
            packet.executionBlockedReason === "admission-blocked" &&
            packet.executionIntentCreated === false &&
            packet.liveRunnerStarted === false &&
            (packet.requiredEvidence ?? []).includes("data-policy-evidence") &&
            (packet.requiredEvidence ?? []).includes("retention-policy-evidence"),
        ),
      (report) =>
        (report?.releaseSmokeExecutionPreflight?.packets ?? []).every(
          (packet) =>
            packet.executionIntentCreated === false &&
            packet.liveRunnerStarted === false &&
            packet.canStartLiveRunner === false,
        ),
    ],
  },
];

const evidenceBySignal = {
  "operator-scope": "operator-scope-evidence",
  "environment-isolation": "environment-isolation-evidence",
  "audit-evidence": "audit-artifact",
  "auth-context": "auth-context-evidence",
  "provider-credentials": "provider-credential-evidence",
  "network-policy": "network-policy-evidence",
  "data-policy": "data-policy-evidence",
  "anonymization-evidence": "anonymization-evidence",
  "retention-policy": "retention-policy-evidence",
};

function readText(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function readJsonOrNull(relativePath) {
  try {
    return JSON.parse(readText(relativePath));
  } catch {
    return null;
  }
}

function releaseSmokeExecutionEvidenceForVerdict(verdict) {
  return [
    ...new Set(
      (verdict?.missingSignals ?? []).map(
        (signal) => evidenceBySignal[signal] ?? `${signal}-evidence`,
      ),
    ),
  ];
}

function createReleaseSmokeExecutionPreflightFromAdmission(admission) {
  const packets = (admission?.verdicts ?? []).map((verdict) => {
    const requiredEvidence = releaseSmokeExecutionEvidenceForVerdict(verdict);
    return {
      schemaVersion: "director.agent-os.release-smoke-execution-preflight-packet.v1",
      id: verdict.id,
      tierId: verdict.tierId,
      status: "blocked",
      readyToExecute: false,
      executionBlockedReason: verdict.admitted ? "evidence-missing" : "admission-blocked",
      requiredEvidence,
      missingEvidence: requiredEvidence,
      executionIntentCreated: false,
      liveRunnerStarted: false,
      canStartLiveRunner: false,
    };
  });
  return {
    schemaVersion: "director.agent-os.release-smoke-execution-preflight.v1",
    status: packets.every((packet) => packet.readyToExecute) ? "ready" : "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      readyToExecuteCount: packets.filter((packet) => packet.readyToExecute).length,
      executionIntentCreatedCount: packets.filter((packet) => packet.executionIntentCreated).length,
      liveRunnerStartedCount: packets.filter((packet) => packet.liveRunnerStarted).length,
      canStartLiveRunnerCount: packets.filter((packet) => packet.canStartLiveRunner).length,
    },
    packets,
  };
}

function resolveExecutionPreflightReport(report) {
  if (report?.releaseSmokeExecutionPreflight) {
    return report;
  }
  if (report?.releaseSmokeAdmission) {
    return {
      ...report,
      releaseSmokeExecutionPreflight: createReleaseSmokeExecutionPreflightFromAdmission(
        report.releaseSmokeAdmission,
      ),
    };
  }
  const admissionGateReport = readJsonOrNull(
    "benchmarks/results/director-phase-h4-agent-os-release-smoke-admission-gate-latest.json",
  );
  const allGateReport = readJsonOrNull("benchmarks/results/director-agent-os-all-gate-latest.json");
  if (allGateReport?.releaseSmokeAdmission) {
    return {
      ...allGateReport,
      releaseSmokeExecutionPreflight: createReleaseSmokeExecutionPreflightFromAdmission(
        allGateReport.releaseSmokeAdmission,
      ),
    };
  }
  return {
    suiteId: "director-agent-os-all-gate",
    releaseSmokeExecutionPreflight: createReleaseSmokeExecutionPreflightFromAdmission(
      admissionGateReport?.artifactCoverage?.[0]?.report?.releaseSmokeAdmission,
    ),
  };
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
      report = resolveExecutionPreflightReport(JSON.parse(readText(item.path)));
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
    note: "Phase H.5 proves live-only release smoke admission verdicts must produce explicit execution preflight evidence packets before any execution intent or live runner can start.",
  },
  sourceCoverage,
  artifactCoverage,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS release smoke execution preflight gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Source coverage: ${report.summary.sourceCoveragePassed}/${report.summary.sourceCoverage}, artifact coverage: ${report.summary.artifactCoveragePassed}/${report.summary.artifactCoverage}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  fail("Director Agent OS release smoke execution preflight gate failed.", failures.join("\n"));
}
