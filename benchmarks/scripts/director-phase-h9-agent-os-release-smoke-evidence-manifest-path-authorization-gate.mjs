import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId =
  "director-phase-h9-agent-os-release-smoke-evidence-manifest-path-authorization-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "agent-os-all-release-smoke-evidence-manifest-path-authorization-artifact-source",
    path: "benchmarks/scripts/director-agent-os-all-gate.mjs",
    needles: [
      "director-phase-h9-agent-os-release-smoke-evidence-manifest-path-authorization-gate",
      "function createReleaseSmokeEvidenceManifestPathAuthorization",
      "const releaseSmokeEvidenceManifestPathAuthorization",
      "releaseSmokeEvidenceManifestPathAuthorization,",
      '"director.agent-os.release-smoke-evidence-manifest-path-authorization.v1"',
      '"operator-owned-local-path"',
      "manifestPathAuthorizedCount",
      "remotePathRejectedCount",
    ],
  },
  {
    id: "release-suite-release-smoke-evidence-manifest-path-authorization-coverage-source",
    path: "benchmarks/scripts/director-agent-os-release-suite-coverage-gate.mjs",
    needles: [
      "director-phase-h9-agent-os-release-smoke-evidence-manifest-path-authorization-gate",
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-path-authorization",
      "live-smoke-evidence-manifest-path-authorization",
      "expectedReleaseSmokeEvidenceManifestPathAuthorizationBenchmarkScript",
      "expectedReleaseSmokeEvidenceManifestPathAuthorizationRootScript",
      "bench:director-agent-os-release-smoke-evidence-manifest-path-authorization",
    ],
  },
  {
    id: "manifest-release-smoke-evidence-manifest-path-authorization-registration-source",
    path: "benchmarks/scripts/wave-suite-manifest.mjs",
    needles: [
      "director-phase-h9-agent-os-release-smoke-evidence-manifest-path-authorization-gate",
      "director-phase-h9-agent-os-release-smoke-evidence-manifest-path-authorization-gate.mjs",
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-path-authorization",
      "Phase H.9 gate proving local operator evidence manifests stay blocked until an operator-owned local path authorization contract",
    ],
  },
  {
    id: "package-release-smoke-evidence-manifest-path-authorization-scripts",
    path: "package.json",
    needles: [
      '"bench:director-agent-os-release-smoke-evidence-manifest-path-authorization"',
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-path-authorization",
    ],
  },
  {
    id: "benchmarks-package-release-smoke-evidence-manifest-path-authorization-script",
    path: "benchmarks/package.json",
    needles: [
      '"bench:director-agent-os-release-smoke-evidence-manifest-path-authorization"',
      "node ./scripts/director-phase-h9-agent-os-release-smoke-evidence-manifest-path-authorization-gate.mjs",
    ],
  },
  {
    id: "desktop-snapshot-release-smoke-evidence-manifest-path-authorization",
    path: "apps/director-desktop/src/desktop-system-handlers.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestPathAuthorizationAssets",
      "agentOsReleaseSmokeEvidenceManifestPathAuthorization",
      '"director.desktop.agent-os-release-smoke-evidence-manifest-path-authorization.v1"',
      "normalizeAgentOsReleaseSmokeEvidenceManifestPathAuthorizationReport",
      "normalizeAgentOsReleaseSmokeEvidenceManifestPathAuthorizationPacket",
      "manifestPathAuthorizationMode",
      "manifestPathAuthorized",
      "manifestPathReadAllowed",
      "manifestDirectoryAllowed",
      "pathTraversalBlocked",
      "remotePathRejected",
      "pathAuthorizationIssues",
    ],
  },
  {
    id: "desktop-review-release-smoke-evidence-manifest-path-authorization-panel",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestPathAuthorizationOpsPanel(review?.agentOsReleaseSmokeEvidenceManifestPathAuthorization)",
      "function createAgentOsReleaseSmokeEvidenceManifestPathAuthorizationOpsPanel",
      "Agent OS 发布 smoke 清单路径授权",
      "manifest path authorization packets",
      "operator-owned local path",
      "manifestPathAuthorized=false",
      "manifestPathReadAllowed=false",
      "remotePathRejected=true",
      "path authorization issues",
      "formatAgentOsReleaseSmokeEvidenceManifestPathAuthorizationIssue",
    ],
  },
  {
    id: "desktop-review-release-smoke-evidence-manifest-path-authorization-structure-test",
    path: "apps/director-desktop/src/app-structure.test.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestPathAuthorizationOpsPanel",
      "formatAgentOsReleaseSmokeEvidenceManifestPathAuthorizationIssue",
      "Agent OS 发布 smoke 清单路径授权",
      ".agent-os-release-smoke-evidence-manifest-path-authorization-panel",
      ".agent-os-release-smoke-evidence-manifest-path-authorization-packet",
      ".agent-os-release-smoke-evidence-manifest-path-authorization-issues",
    ],
  },
  {
    id: "desktop-snapshot-release-smoke-evidence-manifest-path-authorization-test",
    path: "apps/director-desktop/src/desktop-system-handlers.test.js",
    needles: [
      "agentOsReleaseSmokeEvidenceManifestPathAuthorization",
      "director.desktop.agent-os-release-smoke-evidence-manifest-path-authorization.v1",
      "director.agent-os.release-smoke-evidence-manifest-path-authorization-packet.v1",
      'manifestPathAuthorizationMode: "operator-owned-local-path"',
      'manifestPathAuthorizationStatus: "blocked"',
      "manifestPathAuthorized: false",
      "manifestPathReadAllowed: false",
      "remotePathRejected: true",
      "pathAuthorizationIssues",
    ],
  },
  {
    id: "desktop-release-smoke-evidence-manifest-path-authorization-styles",
    path: "apps/director-desktop/src/styles.css",
    needles: [
      ".agent-os-release-smoke-evidence-manifest-path-authorization-panel",
      ".agent-os-release-smoke-evidence-manifest-path-authorization-body",
      ".agent-os-release-smoke-evidence-manifest-path-authorization-packets",
      ".agent-os-release-smoke-evidence-manifest-path-authorization-packet",
      ".agent-os-release-smoke-evidence-manifest-path-authorization-issues",
    ],
  },
];

const requiredArtifactCoverage = [
  {
    id: "agent-os-all-latest-release-smoke-evidence-manifest-path-authorization-artifact",
    path: "benchmarks/results/director-agent-os-all-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-agent-os-all-gate",
      (report) =>
        report?.releaseSmokeEvidenceManifestPathAuthorization?.schemaVersion ===
        "director.agent-os.release-smoke-evidence-manifest-path-authorization.v1",
      (report) => report?.releaseSmokeEvidenceManifestPathAuthorization?.summary?.packetCount === 7,
      (report) =>
        report?.releaseSmokeEvidenceManifestPathAuthorization?.summary?.blockedCount === 7,
      (report) =>
        report?.releaseSmokeEvidenceManifestPathAuthorization?.summary
          ?.manifestPathAuthorizedCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestPathAuthorization?.summary
          ?.manifestPathReadAllowedCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestPathAuthorization?.summary
          ?.manifestDirectoryAllowedCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestPathAuthorization?.summary?.remotePathRejectedCount ===
        7,
      (report) =>
        report?.releaseSmokeEvidenceManifestPathAuthorization?.summary
          ?.runnerIntentUnlockedCount === 0,
      (report) =>
        (report?.releaseSmokeEvidenceManifestPathAuthorization?.packets ?? []).every(
          (packet) =>
            packet.manifestPathAuthorizationMode === "operator-owned-local-path" &&
            packet.manifestPathAuthorizationStatus === "blocked" &&
            packet.manifestPathAuthorized === false &&
            packet.manifestPathReadAllowed === false &&
            packet.manifestDirectoryAllowed === false &&
            packet.pathTraversalBlocked === true &&
            packet.remotePathRejected === true &&
            packet.manifestContentRead === false &&
            packet.auditArtifactReady === false &&
            packet.runnerIntentUnlocked === false,
        ),
      (report) =>
        (report?.releaseSmokeEvidenceManifestPathAuthorization?.packets ?? []).some(
          (packet) =>
            packet.id === "live-user-memory-dataset-sweep" &&
            packet.tierId === "real-data" &&
            (packet.pathAuthorizationIssues ?? []).includes("operator-owned-path-missing") &&
            (packet.pathAuthorizationIssues ?? []).includes("manifest-read-not-authorized"),
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

function createManifestPathAuthorizationFromValidation(manifestValidation) {
  const packets = (manifestValidation?.packets ?? []).map((packet) => ({
    schemaVersion: "director.agent-os.release-smoke-evidence-manifest-path-authorization-packet.v1",
    id: packet.id,
    tierId: packet.tierId,
    status: "blocked",
    manifestSchemaVersion:
      packet.manifestSchemaVersion ?? "director.agent-os.release-smoke-evidence-manifest.v1",
    evidenceManifestPath: packet.evidenceManifestPath ?? null,
    manifestPathStatus: packet.manifestPathStatus ?? "missing",
    manifestPathAuthorizationMode: "operator-owned-local-path",
    manifestPathAuthorizationStatus: "blocked",
    manifestPathAuthorized: false,
    manifestPathReadAllowed: false,
    manifestDirectoryAllowed: false,
    pathTraversalBlocked: true,
    remotePathRejected: true,
    manifestContentRead: false,
    auditArtifactReady: false,
    runnerIntentUnlocked: false,
    pathAuthorizationIssues: [
      "operator-owned-path-missing",
      "manifest-directory-not-allowlisted",
      "manifest-read-not-authorized",
      "remote-path-rejected",
    ],
    manifestValidationStatus: packet.manifestValidationStatus ?? packet.status,
  }));
  return {
    schemaVersion: "director.agent-os.release-smoke-evidence-manifest-path-authorization.v1",
    status: "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      manifestPathAuthorizedCount: 0,
      manifestPathReadAllowedCount: 0,
      manifestDirectoryAllowedCount: 0,
      remotePathRejectedCount: packets.filter((packet) => packet.remotePathRejected).length,
      runnerIntentUnlockedCount: 0,
    },
    packets,
  };
}

function resolveManifestPathAuthorizationReport(report) {
  if (report?.releaseSmokeEvidenceManifestPathAuthorization) {
    return report;
  }
  if (report?.releaseSmokeEvidenceManifestValidation) {
    return {
      ...report,
      releaseSmokeEvidenceManifestPathAuthorization: createManifestPathAuthorizationFromValidation(
        report.releaseSmokeEvidenceManifestValidation,
      ),
    };
  }
  const allGateReport = readJsonOrNull("benchmarks/results/director-agent-os-all-gate-latest.json");
  return {
    ...(allGateReport ?? { suiteId: "director-agent-os-all-gate" }),
    releaseSmokeEvidenceManifestPathAuthorization: createManifestPathAuthorizationFromValidation(
      allGateReport?.releaseSmokeEvidenceManifestValidation,
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
      report = resolveManifestPathAuthorizationReport(JSON.parse(readText(item.path)));
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
  `Director Agent OS release smoke evidence manifest path authorization gate completed: ${report.status}\n`,
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
    "Director Agent OS release smoke evidence manifest path authorization gate failed.",
    [sourceDetails, artifactDetails].filter(Boolean).join("\n"),
  );
}
