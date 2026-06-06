import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId =
  "director-phase-h13-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "agent-os-all-release-smoke-evidence-manifest-audit-artifact-readiness-artifact-source",
    path: "benchmarks/scripts/director-agent-os-all-gate.mjs",
    needles: [
      "director-phase-h13-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-gate",
      "function createReleaseSmokeEvidenceManifestAuditArtifactReadiness",
      "const releaseSmokeEvidenceManifestAuditArtifactReadiness",
      "releaseSmokeEvidenceManifestAuditArtifactReadiness,",
      '"director.agent-os.release-smoke-evidence-manifest-audit-artifact-readiness.v1"',
      '"local-audit-artifact-contract"',
      "auditArtifactReadinessReadyCount",
      "auditArtifactWriteAuthorizedCount",
    ],
  },
  {
    id: "release-suite-release-smoke-evidence-manifest-audit-artifact-readiness-coverage-source",
    path: "benchmarks/scripts/director-agent-os-release-suite-coverage-gate.mjs",
    needles: [
      "director-phase-h13-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-gate",
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness",
      "live-smoke-evidence-manifest-audit-artifact-readiness",
      "expectedReleaseSmokeEvidenceManifestAuditArtifactReadinessBenchmarkScript",
      "expectedReleaseSmokeEvidenceManifestAuditArtifactReadinessRootScript",
      "bench:director-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness",
    ],
  },
  {
    id: "manifest-release-smoke-evidence-manifest-audit-artifact-readiness-registration-source",
    path: "benchmarks/scripts/wave-suite-manifest.mjs",
    needles: [
      "director-phase-h13-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-gate",
      "director-phase-h13-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-gate.mjs",
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness",
      "Phase H.13 gate proving audit artifact readiness stays blocked until local audit artifact path, write authorization, manifest read authorization, manifest content read state, and runner intent controls",
    ],
  },
  {
    id: "package-release-smoke-evidence-manifest-audit-artifact-readiness-scripts",
    path: "package.json",
    needles: [
      '"bench:director-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness"',
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness",
    ],
  },
  {
    id: "benchmarks-package-release-smoke-evidence-manifest-audit-artifact-readiness-script",
    path: "benchmarks/package.json",
    needles: [
      '"bench:director-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness"',
      "node ./scripts/director-phase-h13-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-gate.mjs",
    ],
  },
  {
    id: "desktop-snapshot-release-smoke-evidence-manifest-audit-artifact-readiness",
    path: "apps/director-desktop/src/desktop-system-handlers.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessAssets",
      "agentOsReleaseSmokeEvidenceManifestAuditArtifactReadiness",
      '"director.desktop.agent-os-release-smoke-evidence-manifest-audit-artifact-readiness.v1"',
      "normalizeAgentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessReport",
      "normalizeAgentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessPacket",
      "auditArtifactReadinessMode",
      "auditArtifactReadinessReady",
      "auditArtifactWriteAuthorized",
      "auditArtifactReadinessIssues",
    ],
  },
  {
    id: "desktop-review-release-smoke-evidence-manifest-audit-artifact-readiness-panel",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessOpsPanel(review?.agentOsReleaseSmokeEvidenceManifestAuditArtifactReadiness)",
      "function createAgentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessOpsPanel",
      "Agent OS 发布 smoke 审计 artifact readiness",
      "audit artifact readiness packets",
      "local audit artifact contract",
      "auditArtifactReady=false",
      "auditArtifactReadinessReady=false",
      "manifestContentRead=false",
      "audit artifact readiness issues",
      "formatAgentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessIssue",
    ],
  },
  {
    id: "desktop-review-release-smoke-evidence-manifest-audit-artifact-readiness-structure-test",
    path: "apps/director-desktop/src/app-structure.test.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessOpsPanel",
      "formatAgentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessIssue",
      "Agent OS 发布 smoke 审计 artifact readiness",
      ".agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-panel",
      ".agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-packet",
      ".agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-issues",
    ],
  },
  {
    id: "desktop-snapshot-release-smoke-evidence-manifest-audit-artifact-readiness-test",
    path: "apps/director-desktop/src/desktop-system-handlers.test.js",
    needles: [
      "agentOsReleaseSmokeEvidenceManifestAuditArtifactReadiness",
      "director.desktop.agent-os-release-smoke-evidence-manifest-audit-artifact-readiness.v1",
      "director.agent-os.release-smoke-evidence-manifest-audit-artifact-readiness-packet.v1",
      'auditArtifactReadinessMode: "local-audit-artifact-contract"',
      'auditArtifactReadinessStatus: "blocked"',
      "auditArtifactReady: false",
      "auditArtifactReadinessReady: false",
      "auditArtifactWriteAuthorized: false",
      "auditArtifactReadinessIssues",
    ],
  },
  {
    id: "desktop-release-smoke-evidence-manifest-audit-artifact-readiness-styles",
    path: "apps/director-desktop/src/styles.css",
    needles: [
      ".agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-panel",
      ".agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-body",
      ".agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-packets",
      ".agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-packet",
      ".agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-issues",
    ],
  },
];

const requiredArtifactCoverage = [
  {
    id: "agent-os-all-latest-release-smoke-evidence-manifest-audit-artifact-readiness-artifact",
    path: "benchmarks/results/director-agent-os-all-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-agent-os-all-gate",
      (report) =>
        report?.releaseSmokeEvidenceManifestAuditArtifactReadiness?.schemaVersion ===
        "director.agent-os.release-smoke-evidence-manifest-audit-artifact-readiness.v1",
      (report) =>
        report?.releaseSmokeEvidenceManifestAuditArtifactReadiness?.summary?.packetCount === 7,
      (report) =>
        report?.releaseSmokeEvidenceManifestAuditArtifactReadiness?.summary?.blockedCount === 7,
      (report) =>
        report?.releaseSmokeEvidenceManifestAuditArtifactReadiness?.summary
          ?.auditArtifactReadyCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestAuditArtifactReadiness?.summary
          ?.auditArtifactReadinessReadyCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestAuditArtifactReadiness?.summary
          ?.auditArtifactWriteAuthorizedCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestAuditArtifactReadiness?.summary
          ?.manifestReadAuthorizationReadyCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestAuditArtifactReadiness?.summary
          ?.manifestReadAllowedCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestAuditArtifactReadiness?.summary
          ?.manifestContentReadCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestAuditArtifactReadiness?.summary
          ?.runnerIntentUnlockedCount === 0,
      (report) =>
        (report?.releaseSmokeEvidenceManifestAuditArtifactReadiness?.packets ?? []).every(
          (packet) =>
            packet.auditArtifactReadinessMode === "local-audit-artifact-contract" &&
            packet.auditArtifactReadinessStatus === "blocked" &&
            packet.auditArtifactReady === false &&
            packet.auditArtifactReadinessReady === false &&
            packet.auditArtifactPath === null &&
            packet.auditArtifactWriteAuthorized === false &&
            packet.manifestReadAuthorizationReady === false &&
            packet.manifestReadAllowed === false &&
            packet.manifestContentRead === false &&
            packet.runnerIntentUnlocked === false,
        ),
      (report) =>
        (report?.releaseSmokeEvidenceManifestAuditArtifactReadiness?.packets ?? []).some(
          (packet) =>
            packet.id === "live-user-memory-dataset-sweep" &&
            packet.tierId === "real-data" &&
            packet.manifestReadAuthorizationStatus === "blocked" &&
            (packet.auditArtifactReadinessIssues ?? []).includes("audit-artifact-path-missing") &&
            (packet.auditArtifactReadinessIssues ?? []).includes(
              "audit-artifact-write-not-authorized",
            ) &&
            (packet.auditArtifactReadinessIssues ?? []).includes(
              "manifest-read-authorization-not-ready",
            ) &&
            (packet.auditArtifactReadinessIssues ?? []).includes("manifest-content-not-read") &&
            (packet.auditArtifactReadinessIssues ?? []).includes("runner-intent-locked"),
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

function createAuditArtifactReadinessFromReadAuthorization(readAuthorization) {
  const packets = (readAuthorization?.packets ?? []).map((packet) => ({
    schemaVersion:
      "director.agent-os.release-smoke-evidence-manifest-audit-artifact-readiness-packet.v1",
    id: packet.id,
    tierId: packet.tierId,
    status: "blocked",
    manifestSchemaVersion:
      packet.manifestSchemaVersion ?? "director.agent-os.release-smoke-evidence-manifest.v1",
    evidenceManifestPath: packet.evidenceManifestPath ?? null,
    manifestPathStatus: packet.manifestPathStatus ?? "missing",
    auditArtifactReadinessMode: "local-audit-artifact-contract",
    auditArtifactReadinessStatus: "blocked",
    auditArtifactReady: false,
    auditArtifactReadinessReady: false,
    auditArtifactPath: null,
    auditArtifactWriteAuthorized: false,
    manifestReadAuthorizationReady: packet.manifestReadAuthorizationReady === true,
    manifestReadAllowed: false,
    manifestContentRead: false,
    runnerIntentUnlocked: false,
    auditArtifactReadinessIssues: [
      "audit-artifact-path-missing",
      "audit-artifact-write-not-authorized",
      "manifest-read-authorization-not-ready",
      "manifest-content-not-read",
      "runner-intent-locked",
    ],
    manifestReadAuthorizationStatus: packet.manifestReadAuthorizationStatus ?? packet.status,
  }));
  return {
    schemaVersion: "director.agent-os.release-smoke-evidence-manifest-audit-artifact-readiness.v1",
    status: "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      auditArtifactReadyCount: 0,
      auditArtifactReadinessReadyCount: 0,
      auditArtifactWriteAuthorizedCount: 0,
      manifestReadAuthorizationReadyCount: 0,
      manifestReadAllowedCount: 0,
      manifestContentReadCount: 0,
      runnerIntentUnlockedCount: 0,
    },
    packets,
  };
}

function resolveAuditArtifactReadinessReport(report) {
  if (report?.releaseSmokeEvidenceManifestAuditArtifactReadiness) {
    return report;
  }
  if (report?.releaseSmokeEvidenceManifestReadAuthorization) {
    return {
      ...report,
      releaseSmokeEvidenceManifestAuditArtifactReadiness:
        createAuditArtifactReadinessFromReadAuthorization(
          report.releaseSmokeEvidenceManifestReadAuthorization,
        ),
    };
  }
  const allGateReport = readJsonOrNull("benchmarks/results/director-agent-os-all-gate-latest.json");
  return {
    ...(allGateReport ?? { suiteId: "director-agent-os-all-gate" }),
    releaseSmokeEvidenceManifestAuditArtifactReadiness:
      createAuditArtifactReadinessFromReadAuthorization(
        allGateReport?.releaseSmokeEvidenceManifestReadAuthorization,
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
      report = resolveAuditArtifactReadinessReport(JSON.parse(readText(item.path)));
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
const report = {
  suiteId,
  generatedAt: new Date().toISOString(),
  status:
    failedSourceCoverage.length === 0 && failedArtifactCoverage.length === 0 ? "passed" : "failed",
  summary: {
    sourceCoverage: sourceCoverage.length - failedSourceCoverage.length,
    requiredSourceCoverage: sourceCoverage.length,
    artifactCoverage: artifactCoverage.length - failedArtifactCoverage.length,
    requiredArtifactCoverage: artifactCoverage.length,
    failed: failedSourceCoverage.length + failedArtifactCoverage.length,
  },
  sourceCoverage,
  artifactCoverage,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS release smoke evidence manifest audit artifact readiness gate completed: ${report.status}\n`,
);
process.stdout.write(
  `Source coverage: ${report.summary.sourceCoverage}/${report.summary.requiredSourceCoverage}, artifact coverage: ${report.summary.artifactCoverage}/${report.summary.requiredArtifactCoverage}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (report.status !== "passed") {
  const sourceDetails = failedSourceCoverage
    .map((result) => `${result.id} missing ${result.missingNeedles.join(", ")} in ${result.path}`)
    .join("\n");
  const artifactDetails = failedArtifactCoverage
    .map((result) => `${result.id} failed ${result.failedChecks.join(", ")} in ${result.path}`)
    .join("\n");
  fail(
    "Director Agent OS release smoke evidence manifest audit artifact readiness gate failed.",
    [sourceDetails, artifactDetails].filter(Boolean).join("\n"),
  );
}
