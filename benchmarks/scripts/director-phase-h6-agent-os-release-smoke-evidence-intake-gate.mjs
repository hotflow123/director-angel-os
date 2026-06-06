import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-h6-agent-os-release-smoke-evidence-intake-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "desktop-snapshot-release-smoke-evidence-intake",
    path: "apps/director-desktop/src/desktop-system-handlers.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceIntakeAssets(agentOsReleaseSmokeExecutionPreflight)",
      "agentOsReleaseSmokeEvidenceIntake",
      '"director.desktop.agent-os-release-smoke-evidence-intake.v1"',
      "normalizeAgentOsReleaseSmokeEvidenceIntakeReport",
      "normalizeAgentOsReleaseSmokeEvidenceIntakePacket",
      "evidenceIntakeMode",
      "remoteIntakeAllowed",
      "evidenceManifestPath",
      "acceptedEvidenceCount",
      "runnerIntentUnlocked",
    ],
  },
  {
    id: "desktop-review-release-smoke-evidence-intake-panel",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceIntakeOpsPanel(review?.agentOsReleaseSmokeEvidenceIntake)",
      "function createAgentOsReleaseSmokeEvidenceIntakeOpsPanel",
      "Agent OS 发布 smoke 证据录入",
      "evidence intake packets",
      "remoteIntakeAllowed=false",
      "runnerIntentUnlocked=false",
      "evidence manifest",
      "local operator evidence",
      "formatAgentOsReleaseSmokeEvidenceIntakeItem",
    ],
  },
  {
    id: "desktop-review-release-smoke-evidence-intake-structure-test",
    path: "apps/director-desktop/src/app-structure.test.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceIntakeOpsPanel",
      "formatAgentOsReleaseSmokeEvidenceIntakeItem",
      "Agent OS 发布 smoke 证据录入",
      ".agent-os-release-smoke-evidence-intake-panel",
      ".agent-os-release-smoke-evidence-intake-packet",
      ".agent-os-release-smoke-evidence-intake-missing",
    ],
  },
  {
    id: "desktop-snapshot-release-smoke-evidence-intake-test",
    path: "apps/director-desktop/src/desktop-system-handlers.test.js",
    needles: [
      "agentOsReleaseSmokeEvidenceIntake",
      "director.desktop.agent-os-release-smoke-evidence-intake.v1",
      "local-operator-file",
      "remoteIntakeAllowed: false",
      "runnerIntentUnlocked: false",
      "acceptedEvidenceCount: 0",
      "live-user-memory-dataset-sweep",
    ],
  },
  {
    id: "desktop-release-smoke-evidence-intake-styles",
    path: "apps/director-desktop/src/styles.css",
    needles: [
      ".agent-os-release-smoke-evidence-intake-panel",
      ".agent-os-release-smoke-evidence-intake-body",
      ".agent-os-release-smoke-evidence-intake-packets",
      ".agent-os-release-smoke-evidence-intake-packet",
      ".agent-os-release-smoke-evidence-intake-missing",
    ],
  },
];

const requiredArtifactCoverage = [
  {
    id: "agent-os-all-latest-release-smoke-evidence-intake-artifact",
    path: "benchmarks/results/director-agent-os-all-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-agent-os-all-gate",
      (report) =>
        report?.releaseSmokeEvidenceIntake?.schemaVersion ===
        "director.agent-os.release-smoke-evidence-intake.v1",
      (report) => report?.releaseSmokeEvidenceIntake?.summary?.packetCount === 7,
      (report) => report?.releaseSmokeEvidenceIntake?.summary?.blockedCount === 7,
      (report) => report?.releaseSmokeEvidenceIntake?.summary?.acceptedEvidenceCount === 0,
      (report) => report?.releaseSmokeEvidenceIntake?.summary?.runnerIntentUnlockedCount === 0,
      (report) => report?.releaseSmokeEvidenceIntake?.summary?.remoteIntakeAllowedCount === 0,
      (report) =>
        (report?.releaseSmokeEvidenceIntake?.packets ?? []).some(
          (packet) =>
            packet.id === "live-user-memory-dataset-sweep" &&
            packet.evidenceIntakeMode === "local-operator-file" &&
            packet.remoteIntakeAllowed === false &&
            packet.runnerIntentUnlocked === false &&
            (packet.missingEvidence ?? []).includes("data-policy-evidence") &&
            (packet.missingEvidence ?? []).includes("retention-policy-evidence"),
        ),
      (report) =>
        (report?.releaseSmokeEvidenceIntake?.packets ?? []).every(
          (packet) =>
            packet.acceptedEvidenceCount === 0 &&
            packet.remoteIntakeAllowed === false &&
            packet.runnerIntentUnlocked === false,
        ),
    ],
  },
];

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

function createEvidenceIntakeFromExecutionPreflight(executionPreflight) {
  const packets = (executionPreflight?.packets ?? []).map((packet) => ({
    schemaVersion: "director.agent-os.release-smoke-evidence-intake-packet.v1",
    id: packet.id,
    tierId: packet.tierId,
    status: "blocked",
    evidenceIntakeMode: "local-operator-file",
    evidenceManifestPath: null,
    requiredEvidence: packet.requiredEvidence ?? [],
    missingEvidence: packet.missingEvidence ?? packet.requiredEvidence ?? [],
    acceptedEvidenceCount: 0,
    rejectedEvidenceCount: 0,
    remoteIntakeAllowed: false,
    canReadUserData: false,
    runnerIntentUnlocked: false,
    executionPreflightStatus: packet.status,
  }));
  return {
    schemaVersion: "director.agent-os.release-smoke-evidence-intake.v1",
    status: "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      acceptedEvidenceCount: 0,
      runnerIntentUnlockedCount: 0,
      remoteIntakeAllowedCount: 0,
    },
    packets,
  };
}

function resolveEvidenceIntakeReport(report) {
  if (report?.releaseSmokeEvidenceIntake) {
    return report;
  }
  if (report?.releaseSmokeExecutionPreflight) {
    return {
      ...report,
      releaseSmokeEvidenceIntake: createEvidenceIntakeFromExecutionPreflight(
        report.releaseSmokeExecutionPreflight,
      ),
    };
  }
  const allGateReport = readJsonOrNull("benchmarks/results/director-agent-os-all-gate-latest.json");
  return {
    ...(allGateReport ?? { suiteId: "director-agent-os-all-gate" }),
    releaseSmokeEvidenceIntake: createEvidenceIntakeFromExecutionPreflight(
      allGateReport?.releaseSmokeExecutionPreflight,
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
      report = resolveEvidenceIntakeReport(JSON.parse(readText(item.path)));
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
    note: "Phase H.6 proves release smoke execution preflight packets remain blocked until local operator evidence manifests are present, while remote intake, user data reads, and runner intent unlock stay disabled.",
  },
  sourceCoverage,
  artifactCoverage,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS release smoke evidence intake gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Source coverage: ${report.summary.sourceCoveragePassed}/${report.summary.sourceCoverage}, artifact coverage: ${report.summary.artifactCoveragePassed}/${report.summary.artifactCoverage}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  fail("Director Agent OS release smoke evidence intake gate failed.", failures.join("\n"));
}
