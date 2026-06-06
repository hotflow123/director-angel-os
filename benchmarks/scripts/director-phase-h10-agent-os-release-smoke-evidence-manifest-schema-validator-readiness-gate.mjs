import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId =
  "director-phase-h10-agent-os-release-smoke-evidence-manifest-schema-validator-readiness-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "agent-os-all-release-smoke-evidence-manifest-schema-validator-readiness-artifact-source",
    path: "benchmarks/scripts/director-agent-os-all-gate.mjs",
    needles: [
      "director-phase-h10-agent-os-release-smoke-evidence-manifest-schema-validator-readiness-gate",
      "function createReleaseSmokeEvidenceManifestSchemaValidatorReadiness",
      "const releaseSmokeEvidenceManifestSchemaValidatorReadiness",
      "releaseSmokeEvidenceManifestSchemaValidatorReadiness,",
      '"director.agent-os.release-smoke-evidence-manifest-schema-validator-readiness.v1"',
      '"local-schema-contract"',
      "schemaValidatorReadyCount",
      "schemaDefinitionLoadedCount",
    ],
  },
  {
    id: "release-suite-release-smoke-evidence-manifest-schema-validator-readiness-coverage-source",
    path: "benchmarks/scripts/director-agent-os-release-suite-coverage-gate.mjs",
    needles: [
      "director-phase-h10-agent-os-release-smoke-evidence-manifest-schema-validator-readiness-gate",
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-schema-validator-readiness",
      "live-smoke-evidence-manifest-schema-validator-readiness",
      "expectedReleaseSmokeEvidenceManifestSchemaValidatorReadinessBenchmarkScript",
      "expectedReleaseSmokeEvidenceManifestSchemaValidatorReadinessRootScript",
      "bench:director-agent-os-release-smoke-evidence-manifest-schema-validator-readiness",
    ],
  },
  {
    id: "manifest-release-smoke-evidence-manifest-schema-validator-readiness-registration-source",
    path: "benchmarks/scripts/wave-suite-manifest.mjs",
    needles: [
      "director-phase-h10-agent-os-release-smoke-evidence-manifest-schema-validator-readiness-gate",
      "director-phase-h10-agent-os-release-smoke-evidence-manifest-schema-validator-readiness-gate.mjs",
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-schema-validator-readiness",
      "Phase H.10 gate proving local schema validator readiness stays blocked until schema binding, path authorization, manifest read authorization, and audit artifact readiness",
    ],
  },
  {
    id: "package-release-smoke-evidence-manifest-schema-validator-readiness-scripts",
    path: "package.json",
    needles: [
      '"bench:director-agent-os-release-smoke-evidence-manifest-schema-validator-readiness"',
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-schema-validator-readiness",
    ],
  },
  {
    id: "benchmarks-package-release-smoke-evidence-manifest-schema-validator-readiness-script",
    path: "benchmarks/package.json",
    needles: [
      '"bench:director-agent-os-release-smoke-evidence-manifest-schema-validator-readiness"',
      "node ./scripts/director-phase-h10-agent-os-release-smoke-evidence-manifest-schema-validator-readiness-gate.mjs",
    ],
  },
  {
    id: "desktop-snapshot-release-smoke-evidence-manifest-schema-validator-readiness",
    path: "apps/director-desktop/src/desktop-system-handlers.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessAssets",
      "agentOsReleaseSmokeEvidenceManifestSchemaValidatorReadiness",
      '"director.desktop.agent-os-release-smoke-evidence-manifest-schema-validator-readiness.v1"',
      "normalizeAgentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessReport",
      "normalizeAgentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessPacket",
      "schemaValidatorMode",
      "schemaValidatorReady",
      "schemaValidatorStatus",
      "schemaDefinitionVersion",
      "schemaDefinitionLoaded",
      "schemaValidatorIssues",
    ],
  },
  {
    id: "desktop-review-release-smoke-evidence-manifest-schema-validator-readiness-panel",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessOpsPanel(review?.agentOsReleaseSmokeEvidenceManifestSchemaValidatorReadiness)",
      "function createAgentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessOpsPanel",
      "Agent OS 发布 smoke 清单 schema 校验器",
      "schema validator readiness packets",
      "local schema contract",
      "schemaValidatorReady=false",
      "schemaDefinitionLoaded=false",
      "manifestReadAllowed=false",
      "schema validator issues",
      "formatAgentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessIssue",
    ],
  },
  {
    id: "desktop-review-release-smoke-evidence-manifest-schema-validator-readiness-structure-test",
    path: "apps/director-desktop/src/app-structure.test.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessOpsPanel",
      "formatAgentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessIssue",
      "Agent OS 发布 smoke 清单 schema 校验器",
      ".agent-os-release-smoke-evidence-manifest-schema-validator-readiness-panel",
      ".agent-os-release-smoke-evidence-manifest-schema-validator-readiness-packet",
      ".agent-os-release-smoke-evidence-manifest-schema-validator-readiness-issues",
    ],
  },
  {
    id: "desktop-snapshot-release-smoke-evidence-manifest-schema-validator-readiness-test",
    path: "apps/director-desktop/src/desktop-system-handlers.test.js",
    needles: [
      "agentOsReleaseSmokeEvidenceManifestSchemaValidatorReadiness",
      "director.desktop.agent-os-release-smoke-evidence-manifest-schema-validator-readiness.v1",
      "director.agent-os.release-smoke-evidence-manifest-schema-validator-readiness-packet.v1",
      'schemaValidatorMode: "local-schema-contract"',
      'schemaValidatorStatus: "blocked"',
      "schemaValidatorReady: false",
      "schemaDefinitionLoaded: false",
      "manifestReadAllowed: false",
      "schemaValidatorIssues",
    ],
  },
  {
    id: "desktop-release-smoke-evidence-manifest-schema-validator-readiness-styles",
    path: "apps/director-desktop/src/styles.css",
    needles: [
      ".agent-os-release-smoke-evidence-manifest-schema-validator-readiness-panel",
      ".agent-os-release-smoke-evidence-manifest-schema-validator-readiness-body",
      ".agent-os-release-smoke-evidence-manifest-schema-validator-readiness-packets",
      ".agent-os-release-smoke-evidence-manifest-schema-validator-readiness-packet",
      ".agent-os-release-smoke-evidence-manifest-schema-validator-readiness-issues",
    ],
  },
];

const requiredArtifactCoverage = [
  {
    id: "agent-os-all-latest-release-smoke-evidence-manifest-schema-validator-readiness-artifact",
    path: "benchmarks/results/director-agent-os-all-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-agent-os-all-gate",
      (report) =>
        report?.releaseSmokeEvidenceManifestSchemaValidatorReadiness?.schemaVersion ===
        "director.agent-os.release-smoke-evidence-manifest-schema-validator-readiness.v1",
      (report) =>
        report?.releaseSmokeEvidenceManifestSchemaValidatorReadiness?.summary?.packetCount === 7,
      (report) =>
        report?.releaseSmokeEvidenceManifestSchemaValidatorReadiness?.summary?.blockedCount === 7,
      (report) =>
        report?.releaseSmokeEvidenceManifestSchemaValidatorReadiness?.summary
          ?.schemaValidatorReadyCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestSchemaValidatorReadiness?.summary
          ?.schemaDefinitionLoadedCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestSchemaValidatorReadiness?.summary
          ?.manifestReadAllowedCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestSchemaValidatorReadiness?.summary
          ?.manifestContentReadCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestSchemaValidatorReadiness?.summary
          ?.auditArtifactReadyCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestSchemaValidatorReadiness?.summary
          ?.runnerIntentUnlockedCount === 0,
      (report) =>
        (report?.releaseSmokeEvidenceManifestSchemaValidatorReadiness?.packets ?? []).every(
          (packet) =>
            packet.schemaValidatorMode === "local-schema-contract" &&
            packet.schemaValidatorStatus === "blocked" &&
            packet.schemaValidatorReady === false &&
            packet.schemaDefinitionVersion ===
              "director.agent-os.release-smoke-evidence-manifest.v1" &&
            packet.schemaDefinitionLoaded === false &&
            packet.manifestReadAllowed === false &&
            packet.manifestContentRead === false &&
            packet.auditArtifactReady === false &&
            packet.runnerIntentUnlocked === false,
        ),
      (report) =>
        (report?.releaseSmokeEvidenceManifestSchemaValidatorReadiness?.packets ?? []).some(
          (packet) =>
            packet.id === "live-user-memory-dataset-sweep" &&
            packet.tierId === "real-data" &&
            packet.pathAuthorizationStatus === "blocked" &&
            (packet.schemaValidatorIssues ?? []).includes("manifest-path-not-authorized") &&
            (packet.schemaValidatorIssues ?? []).includes("schema-definition-not-bound") &&
            (packet.schemaValidatorIssues ?? []).includes("manifest-read-not-authorized") &&
            (packet.schemaValidatorIssues ?? []).includes("audit-artifact-not-ready"),
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

function createManifestSchemaValidatorReadinessFromPathAuthorization(pathAuthorization) {
  const packets = (pathAuthorization?.packets ?? []).map((packet) => ({
    schemaVersion:
      "director.agent-os.release-smoke-evidence-manifest-schema-validator-readiness-packet.v1",
    id: packet.id,
    tierId: packet.tierId,
    status: "blocked",
    manifestSchemaVersion:
      packet.manifestSchemaVersion ?? "director.agent-os.release-smoke-evidence-manifest.v1",
    evidenceManifestPath: packet.evidenceManifestPath ?? null,
    manifestPathStatus: packet.manifestPathStatus ?? "missing",
    schemaValidatorMode: "local-schema-contract",
    schemaValidatorStatus: "blocked",
    schemaValidatorReady: false,
    schemaDefinitionVersion: "director.agent-os.release-smoke-evidence-manifest.v1",
    schemaDefinitionLoaded: false,
    manifestPathAuthorized: packet.manifestPathAuthorized === true,
    manifestReadAllowed: false,
    manifestContentRead: false,
    auditArtifactReady: false,
    runnerIntentUnlocked: false,
    schemaValidatorIssues: [
      "manifest-path-not-authorized",
      "schema-definition-not-bound",
      "manifest-read-not-authorized",
      "audit-artifact-not-ready",
    ],
    pathAuthorizationStatus: packet.manifestPathAuthorizationStatus ?? packet.status,
  }));
  return {
    schemaVersion:
      "director.agent-os.release-smoke-evidence-manifest-schema-validator-readiness.v1",
    status: "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      schemaValidatorReadyCount: 0,
      schemaDefinitionLoadedCount: 0,
      manifestReadAllowedCount: 0,
      manifestContentReadCount: 0,
      auditArtifactReadyCount: 0,
      runnerIntentUnlockedCount: 0,
    },
    packets,
  };
}

function resolveManifestSchemaValidatorReadinessReport(report) {
  if (report?.releaseSmokeEvidenceManifestSchemaValidatorReadiness) {
    return report;
  }
  if (report?.releaseSmokeEvidenceManifestPathAuthorization) {
    return {
      ...report,
      releaseSmokeEvidenceManifestSchemaValidatorReadiness:
        createManifestSchemaValidatorReadinessFromPathAuthorization(
          report.releaseSmokeEvidenceManifestPathAuthorization,
        ),
    };
  }
  const allGateReport = readJsonOrNull("benchmarks/results/director-agent-os-all-gate-latest.json");
  return {
    ...(allGateReport ?? { suiteId: "director-agent-os-all-gate" }),
    releaseSmokeEvidenceManifestSchemaValidatorReadiness:
      createManifestSchemaValidatorReadinessFromPathAuthorization(
        allGateReport?.releaseSmokeEvidenceManifestPathAuthorization,
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
      report = resolveManifestSchemaValidatorReadinessReport(JSON.parse(readText(item.path)));
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
  `Director Agent OS release smoke evidence manifest schema validator readiness gate completed: ${report.status}\n`,
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
    "Director Agent OS release smoke evidence manifest schema validator readiness gate failed.",
    [sourceDetails, artifactDetails].filter(Boolean).join("\n"),
  );
}
