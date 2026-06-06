import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId =
  "director-phase-h12-agent-os-release-smoke-evidence-manifest-read-authorization-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "agent-os-all-release-smoke-evidence-manifest-read-authorization-artifact-source",
    path: "benchmarks/scripts/director-agent-os-all-gate.mjs",
    needles: [
      "director-phase-h12-agent-os-release-smoke-evidence-manifest-read-authorization-gate",
      "function createReleaseSmokeEvidenceManifestReadAuthorization",
      "const releaseSmokeEvidenceManifestReadAuthorization",
      "releaseSmokeEvidenceManifestReadAuthorization,",
      '"director.agent-os.release-smoke-evidence-manifest-read-authorization.v1"',
      '"local-manifest-read-authorization"',
      "manifestReadAuthorizedCount",
      "manifestReadAuthorizationReadyCount",
    ],
  },
  {
    id: "release-suite-release-smoke-evidence-manifest-read-authorization-coverage-source",
    path: "benchmarks/scripts/director-agent-os-release-suite-coverage-gate.mjs",
    needles: [
      "director-phase-h12-agent-os-release-smoke-evidence-manifest-read-authorization-gate",
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-read-authorization",
      "live-smoke-evidence-manifest-read-authorization",
      "expectedReleaseSmokeEvidenceManifestReadAuthorizationBenchmarkScript",
      "expectedReleaseSmokeEvidenceManifestReadAuthorizationRootScript",
      "bench:director-agent-os-release-smoke-evidence-manifest-read-authorization",
    ],
  },
  {
    id: "manifest-release-smoke-evidence-manifest-read-authorization-registration-source",
    path: "benchmarks/scripts/wave-suite-manifest.mjs",
    needles: [
      "director-phase-h12-agent-os-release-smoke-evidence-manifest-read-authorization-gate",
      "director-phase-h12-agent-os-release-smoke-evidence-manifest-read-authorization-gate.mjs",
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-read-authorization",
      "Phase H.12 gate proving manifest read authorization stays blocked until operator read scope, local path authorization, schema definition binding, audit artifact readiness",
    ],
  },
  {
    id: "package-release-smoke-evidence-manifest-read-authorization-scripts",
    path: "package.json",
    needles: [
      '"bench:director-agent-os-release-smoke-evidence-manifest-read-authorization"',
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-read-authorization",
    ],
  },
  {
    id: "benchmarks-package-release-smoke-evidence-manifest-read-authorization-script",
    path: "benchmarks/package.json",
    needles: [
      '"bench:director-agent-os-release-smoke-evidence-manifest-read-authorization"',
      "node ./scripts/director-phase-h12-agent-os-release-smoke-evidence-manifest-read-authorization-gate.mjs",
    ],
  },
  {
    id: "desktop-snapshot-release-smoke-evidence-manifest-read-authorization",
    path: "apps/director-desktop/src/desktop-system-handlers.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestReadAuthorizationAssets",
      "agentOsReleaseSmokeEvidenceManifestReadAuthorization",
      '"director.desktop.agent-os-release-smoke-evidence-manifest-read-authorization.v1"',
      "normalizeAgentOsReleaseSmokeEvidenceManifestReadAuthorizationReport",
      "normalizeAgentOsReleaseSmokeEvidenceManifestReadAuthorizationPacket",
      "manifestReadAuthorizationMode",
      "manifestReadAuthorized",
      "manifestReadAuthorizationStatus",
      "manifestReadAuthorizationIssues",
    ],
  },
  {
    id: "desktop-review-release-smoke-evidence-manifest-read-authorization-panel",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestReadAuthorizationOpsPanel(review?.agentOsReleaseSmokeEvidenceManifestReadAuthorization)",
      "function createAgentOsReleaseSmokeEvidenceManifestReadAuthorizationOpsPanel",
      "Agent OS 发布 smoke 清单读取授权",
      "manifest read authorization packets",
      "local manifest read authorization",
      "manifestReadAuthorized=false",
      "manifestReadAuthorizationReady=false",
      "manifestContentRead=false",
      "manifest read authorization issues",
      "formatAgentOsReleaseSmokeEvidenceManifestReadAuthorizationIssue",
    ],
  },
  {
    id: "desktop-review-release-smoke-evidence-manifest-read-authorization-structure-test",
    path: "apps/director-desktop/src/app-structure.test.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestReadAuthorizationOpsPanel",
      "formatAgentOsReleaseSmokeEvidenceManifestReadAuthorizationIssue",
      "Agent OS 发布 smoke 清单读取授权",
      ".agent-os-release-smoke-evidence-manifest-read-authorization-panel",
      ".agent-os-release-smoke-evidence-manifest-read-authorization-packet",
      ".agent-os-release-smoke-evidence-manifest-read-authorization-issues",
    ],
  },
  {
    id: "desktop-snapshot-release-smoke-evidence-manifest-read-authorization-test",
    path: "apps/director-desktop/src/desktop-system-handlers.test.js",
    needles: [
      "agentOsReleaseSmokeEvidenceManifestReadAuthorization",
      "director.desktop.agent-os-release-smoke-evidence-manifest-read-authorization.v1",
      "director.agent-os.release-smoke-evidence-manifest-read-authorization-packet.v1",
      'manifestReadAuthorizationMode: "local-manifest-read-authorization"',
      'manifestReadAuthorizationStatus: "blocked"',
      "manifestReadAuthorized: false",
      "manifestReadAuthorizationReady: false",
      "manifestContentRead: false",
      "manifestReadAuthorizationIssues",
    ],
  },
  {
    id: "desktop-release-smoke-evidence-manifest-read-authorization-styles",
    path: "apps/director-desktop/src/styles.css",
    needles: [
      ".agent-os-release-smoke-evidence-manifest-read-authorization-panel",
      ".agent-os-release-smoke-evidence-manifest-read-authorization-body",
      ".agent-os-release-smoke-evidence-manifest-read-authorization-packets",
      ".agent-os-release-smoke-evidence-manifest-read-authorization-packet",
      ".agent-os-release-smoke-evidence-manifest-read-authorization-issues",
    ],
  },
];

const requiredArtifactCoverage = [
  {
    id: "agent-os-all-latest-release-smoke-evidence-manifest-read-authorization-artifact",
    path: "benchmarks/results/director-agent-os-all-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-agent-os-all-gate",
      (report) =>
        report?.releaseSmokeEvidenceManifestReadAuthorization?.schemaVersion ===
        "director.agent-os.release-smoke-evidence-manifest-read-authorization.v1",
      (report) => report?.releaseSmokeEvidenceManifestReadAuthorization?.summary?.packetCount === 7,
      (report) =>
        report?.releaseSmokeEvidenceManifestReadAuthorization?.summary?.blockedCount === 7,
      (report) =>
        report?.releaseSmokeEvidenceManifestReadAuthorization?.summary
          ?.manifestReadAuthorizedCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestReadAuthorization?.summary
          ?.manifestReadAuthorizationReadyCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestReadAuthorization?.summary?.manifestReadAllowedCount ===
        0,
      (report) =>
        report?.releaseSmokeEvidenceManifestReadAuthorization?.summary?.manifestContentReadCount ===
        0,
      (report) =>
        report?.releaseSmokeEvidenceManifestReadAuthorization?.summary?.auditArtifactReadyCount ===
        0,
      (report) =>
        report?.releaseSmokeEvidenceManifestReadAuthorization?.summary
          ?.runnerIntentUnlockedCount === 0,
      (report) =>
        (report?.releaseSmokeEvidenceManifestReadAuthorization?.packets ?? []).every(
          (packet) =>
            packet.manifestReadAuthorizationMode === "local-manifest-read-authorization" &&
            packet.manifestReadAuthorizationStatus === "blocked" &&
            packet.manifestReadAuthorized === false &&
            packet.manifestReadAuthorizationReady === false &&
            packet.operatorReadScopeGranted === false &&
            packet.schemaDefinitionBindingReady === false &&
            packet.manifestPathAuthorized === false &&
            packet.manifestReadAllowed === false &&
            packet.manifestContentRead === false &&
            packet.auditArtifactReady === false &&
            packet.runnerIntentUnlocked === false,
        ),
      (report) =>
        (report?.releaseSmokeEvidenceManifestReadAuthorization?.packets ?? []).some(
          (packet) =>
            packet.id === "live-user-memory-dataset-sweep" &&
            packet.tierId === "real-data" &&
            packet.schemaDefinitionBindingStatus === "blocked" &&
            (packet.manifestReadAuthorizationIssues ?? []).includes(
              "operator-read-scope-missing",
            ) &&
            (packet.manifestReadAuthorizationIssues ?? []).includes(
              "manifest-path-not-authorized",
            ) &&
            (packet.manifestReadAuthorizationIssues ?? []).includes(
              "schema-definition-binding-not-ready",
            ) &&
            (packet.manifestReadAuthorizationIssues ?? []).includes("audit-artifact-not-ready"),
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

function createReadAuthorizationFromSchemaDefinitionBinding(schemaDefinitionBinding) {
  const packets = (schemaDefinitionBinding?.packets ?? []).map((packet) => ({
    schemaVersion: "director.agent-os.release-smoke-evidence-manifest-read-authorization-packet.v1",
    id: packet.id,
    tierId: packet.tierId,
    status: "blocked",
    manifestSchemaVersion:
      packet.manifestSchemaVersion ?? "director.agent-os.release-smoke-evidence-manifest.v1",
    evidenceManifestPath: packet.evidenceManifestPath ?? null,
    manifestPathStatus: packet.manifestPathStatus ?? "missing",
    manifestReadAuthorizationMode: "local-manifest-read-authorization",
    manifestReadAuthorizationStatus: "blocked",
    manifestReadAuthorized: false,
    manifestReadAuthorizationReady: false,
    operatorReadScopeGranted: false,
    schemaDefinitionBindingReady: packet.schemaDefinitionBindingReady === true,
    manifestPathAuthorized: false,
    manifestReadAllowed: false,
    manifestContentRead: false,
    auditArtifactReady: false,
    runnerIntentUnlocked: false,
    manifestReadAuthorizationIssues: [
      "operator-read-scope-missing",
      "manifest-path-not-authorized",
      "schema-definition-binding-not-ready",
      "audit-artifact-not-ready",
    ],
    schemaDefinitionBindingStatus: packet.schemaDefinitionBindingStatus ?? packet.status,
  }));
  return {
    schemaVersion: "director.agent-os.release-smoke-evidence-manifest-read-authorization.v1",
    status: "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      manifestReadAuthorizedCount: 0,
      manifestReadAuthorizationReadyCount: 0,
      manifestReadAllowedCount: 0,
      manifestContentReadCount: 0,
      auditArtifactReadyCount: 0,
      runnerIntentUnlockedCount: 0,
    },
    packets,
  };
}

function resolveReadAuthorizationReport(report) {
  if (report?.releaseSmokeEvidenceManifestReadAuthorization) {
    return report;
  }
  if (report?.releaseSmokeEvidenceManifestSchemaDefinitionBinding) {
    return {
      ...report,
      releaseSmokeEvidenceManifestReadAuthorization:
        createReadAuthorizationFromSchemaDefinitionBinding(
          report.releaseSmokeEvidenceManifestSchemaDefinitionBinding,
        ),
    };
  }
  const allGateReport = readJsonOrNull("benchmarks/results/director-agent-os-all-gate-latest.json");
  return {
    ...(allGateReport ?? { suiteId: "director-agent-os-all-gate" }),
    releaseSmokeEvidenceManifestReadAuthorization:
      createReadAuthorizationFromSchemaDefinitionBinding(
        allGateReport?.releaseSmokeEvidenceManifestSchemaDefinitionBinding,
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
      report = resolveReadAuthorizationReport(JSON.parse(readText(item.path)));
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
  `Director Agent OS release smoke evidence manifest read authorization gate completed: ${report.status}\n`,
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
    "Director Agent OS release smoke evidence manifest read authorization gate failed.",
    [sourceDetails, artifactDetails].filter(Boolean).join("\n"),
  );
}
