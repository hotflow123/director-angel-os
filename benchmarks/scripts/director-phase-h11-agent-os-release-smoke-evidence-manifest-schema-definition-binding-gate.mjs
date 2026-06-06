import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId =
  "director-phase-h11-agent-os-release-smoke-evidence-manifest-schema-definition-binding-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "agent-os-all-release-smoke-evidence-manifest-schema-definition-binding-artifact-source",
    path: "benchmarks/scripts/director-agent-os-all-gate.mjs",
    needles: [
      "director-phase-h11-agent-os-release-smoke-evidence-manifest-schema-definition-binding-gate",
      "function createReleaseSmokeEvidenceManifestSchemaDefinitionBinding",
      "const releaseSmokeEvidenceManifestSchemaDefinitionBinding",
      "releaseSmokeEvidenceManifestSchemaDefinitionBinding,",
      '"director.agent-os.release-smoke-evidence-manifest-schema-definition-binding.v1"',
      '"embedded-schema-definition-ref"',
      "schemaDefinitionBoundCount",
      "schemaDefinitionBindingReadyCount",
    ],
  },
  {
    id: "release-suite-release-smoke-evidence-manifest-schema-definition-binding-coverage-source",
    path: "benchmarks/scripts/director-agent-os-release-suite-coverage-gate.mjs",
    needles: [
      "director-phase-h11-agent-os-release-smoke-evidence-manifest-schema-definition-binding-gate",
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-schema-definition-binding",
      "live-smoke-evidence-manifest-schema-definition-binding",
      "expectedReleaseSmokeEvidenceManifestSchemaDefinitionBindingBenchmarkScript",
      "expectedReleaseSmokeEvidenceManifestSchemaDefinitionBindingRootScript",
      "bench:director-agent-os-release-smoke-evidence-manifest-schema-definition-binding",
    ],
  },
  {
    id: "manifest-release-smoke-evidence-manifest-schema-definition-binding-registration-source",
    path: "benchmarks/scripts/wave-suite-manifest.mjs",
    needles: [
      "director-phase-h11-agent-os-release-smoke-evidence-manifest-schema-definition-binding-gate",
      "director-phase-h11-agent-os-release-smoke-evidence-manifest-schema-definition-binding-gate.mjs",
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-schema-definition-binding",
      "Phase H.11 gate proving schema definition binding stays blocked until a local schema definition reference, schema loader, validator readiness, manifest read authorization, and audit artifact readiness",
    ],
  },
  {
    id: "package-release-smoke-evidence-manifest-schema-definition-binding-scripts",
    path: "package.json",
    needles: [
      '"bench:director-agent-os-release-smoke-evidence-manifest-schema-definition-binding"',
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-schema-definition-binding",
    ],
  },
  {
    id: "benchmarks-package-release-smoke-evidence-manifest-schema-definition-binding-script",
    path: "benchmarks/package.json",
    needles: [
      '"bench:director-agent-os-release-smoke-evidence-manifest-schema-definition-binding"',
      "node ./scripts/director-phase-h11-agent-os-release-smoke-evidence-manifest-schema-definition-binding-gate.mjs",
    ],
  },
  {
    id: "desktop-snapshot-release-smoke-evidence-manifest-schema-definition-binding",
    path: "apps/director-desktop/src/desktop-system-handlers.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingAssets",
      "agentOsReleaseSmokeEvidenceManifestSchemaDefinitionBinding",
      '"director.desktop.agent-os-release-smoke-evidence-manifest-schema-definition-binding.v1"',
      "normalizeAgentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingReport",
      "normalizeAgentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingPacket",
      "schemaDefinitionBindingMode",
      "schemaDefinitionBound",
      "schemaDefinitionBindingStatus",
      "schemaDefinitionReference",
      "schemaDefinitionBindingIssues",
    ],
  },
  {
    id: "desktop-review-release-smoke-evidence-manifest-schema-definition-binding-panel",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingOpsPanel(review?.agentOsReleaseSmokeEvidenceManifestSchemaDefinitionBinding)",
      "function createAgentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingOpsPanel",
      "Agent OS 发布 smoke 清单 schema 定义绑定",
      "schema definition binding packets",
      "embedded schema definition ref",
      "schemaDefinitionBound=false",
      "schemaDefinitionBindingReady=false",
      "manifestReadAllowed=false",
      "schema definition binding issues",
      "formatAgentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingIssue",
    ],
  },
  {
    id: "desktop-review-release-smoke-evidence-manifest-schema-definition-binding-structure-test",
    path: "apps/director-desktop/src/app-structure.test.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingOpsPanel",
      "formatAgentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingIssue",
      "Agent OS 发布 smoke 清单 schema 定义绑定",
      ".agent-os-release-smoke-evidence-manifest-schema-definition-binding-panel",
      ".agent-os-release-smoke-evidence-manifest-schema-definition-binding-packet",
      ".agent-os-release-smoke-evidence-manifest-schema-definition-binding-issues",
    ],
  },
  {
    id: "desktop-snapshot-release-smoke-evidence-manifest-schema-definition-binding-test",
    path: "apps/director-desktop/src/desktop-system-handlers.test.js",
    needles: [
      "agentOsReleaseSmokeEvidenceManifestSchemaDefinitionBinding",
      "director.desktop.agent-os-release-smoke-evidence-manifest-schema-definition-binding.v1",
      "director.agent-os.release-smoke-evidence-manifest-schema-definition-binding-packet.v1",
      'schemaDefinitionBindingMode: "embedded-schema-definition-ref"',
      'schemaDefinitionBindingStatus: "blocked"',
      "schemaDefinitionBound: false",
      "schemaDefinitionBindingReady: false",
      "manifestReadAllowed: false",
      "schemaDefinitionBindingIssues",
    ],
  },
  {
    id: "desktop-release-smoke-evidence-manifest-schema-definition-binding-styles",
    path: "apps/director-desktop/src/styles.css",
    needles: [
      ".agent-os-release-smoke-evidence-manifest-schema-definition-binding-panel",
      ".agent-os-release-smoke-evidence-manifest-schema-definition-binding-body",
      ".agent-os-release-smoke-evidence-manifest-schema-definition-binding-packets",
      ".agent-os-release-smoke-evidence-manifest-schema-definition-binding-packet",
      ".agent-os-release-smoke-evidence-manifest-schema-definition-binding-issues",
    ],
  },
];

const requiredArtifactCoverage = [
  {
    id: "agent-os-all-latest-release-smoke-evidence-manifest-schema-definition-binding-artifact",
    path: "benchmarks/results/director-agent-os-all-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-agent-os-all-gate",
      (report) =>
        report?.releaseSmokeEvidenceManifestSchemaDefinitionBinding?.schemaVersion ===
        "director.agent-os.release-smoke-evidence-manifest-schema-definition-binding.v1",
      (report) =>
        report?.releaseSmokeEvidenceManifestSchemaDefinitionBinding?.summary?.packetCount === 7,
      (report) =>
        report?.releaseSmokeEvidenceManifestSchemaDefinitionBinding?.summary?.blockedCount === 7,
      (report) =>
        report?.releaseSmokeEvidenceManifestSchemaDefinitionBinding?.summary
          ?.schemaDefinitionBoundCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestSchemaDefinitionBinding?.summary
          ?.schemaDefinitionBindingReadyCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestSchemaDefinitionBinding?.summary
          ?.manifestReadAllowedCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestSchemaDefinitionBinding?.summary
          ?.manifestContentReadCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestSchemaDefinitionBinding?.summary
          ?.auditArtifactReadyCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestSchemaDefinitionBinding?.summary
          ?.runnerIntentUnlockedCount === 0,
      (report) =>
        (report?.releaseSmokeEvidenceManifestSchemaDefinitionBinding?.packets ?? []).every(
          (packet) =>
            packet.schemaDefinitionBindingMode === "embedded-schema-definition-ref" &&
            packet.schemaDefinitionBindingStatus === "blocked" &&
            packet.schemaDefinitionBound === false &&
            packet.schemaDefinitionBindingReady === false &&
            packet.schemaDefinitionReference ===
              "director.agent-os.release-smoke-evidence-manifest.v1" &&
            packet.schemaLoaderReady === false &&
            packet.manifestReadAllowed === false &&
            packet.manifestContentRead === false &&
            packet.auditArtifactReady === false &&
            packet.runnerIntentUnlocked === false,
        ),
      (report) =>
        (report?.releaseSmokeEvidenceManifestSchemaDefinitionBinding?.packets ?? []).some(
          (packet) =>
            packet.id === "live-user-memory-dataset-sweep" &&
            packet.tierId === "real-data" &&
            packet.schemaValidatorStatus === "blocked" &&
            (packet.schemaDefinitionBindingIssues ?? []).includes("schema-definition-not-bound") &&
            (packet.schemaDefinitionBindingIssues ?? []).includes("schema-loader-not-ready") &&
            (packet.schemaDefinitionBindingIssues ?? []).includes("validator-not-ready") &&
            (packet.schemaDefinitionBindingIssues ?? []).includes("manifest-read-not-authorized") &&
            (packet.schemaDefinitionBindingIssues ?? []).includes("audit-artifact-not-ready"),
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

function createSchemaDefinitionBindingFromValidatorReadiness(schemaValidatorReadiness) {
  const packets = (schemaValidatorReadiness?.packets ?? []).map((packet) => ({
    schemaVersion:
      "director.agent-os.release-smoke-evidence-manifest-schema-definition-binding-packet.v1",
    id: packet.id,
    tierId: packet.tierId,
    status: "blocked",
    manifestSchemaVersion:
      packet.manifestSchemaVersion ?? "director.agent-os.release-smoke-evidence-manifest.v1",
    evidenceManifestPath: packet.evidenceManifestPath ?? null,
    manifestPathStatus: packet.manifestPathStatus ?? "missing",
    schemaDefinitionBindingMode: "embedded-schema-definition-ref",
    schemaDefinitionBindingStatus: "blocked",
    schemaDefinitionBound: false,
    schemaDefinitionBindingReady: false,
    schemaDefinitionReference: "director.agent-os.release-smoke-evidence-manifest.v1",
    schemaDefinitionLoaded: packet.schemaDefinitionLoaded === true,
    schemaLoaderReady: false,
    schemaValidatorReady: packet.schemaValidatorReady === true,
    manifestReadAllowed: false,
    manifestContentRead: false,
    auditArtifactReady: false,
    runnerIntentUnlocked: false,
    schemaDefinitionBindingIssues: [
      "schema-definition-not-bound",
      "schema-loader-not-ready",
      "validator-not-ready",
      "manifest-read-not-authorized",
      "audit-artifact-not-ready",
    ],
    schemaValidatorStatus: packet.schemaValidatorStatus ?? packet.status,
  }));
  return {
    schemaVersion: "director.agent-os.release-smoke-evidence-manifest-schema-definition-binding.v1",
    status: "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      schemaDefinitionBoundCount: 0,
      schemaDefinitionBindingReadyCount: 0,
      manifestReadAllowedCount: 0,
      manifestContentReadCount: 0,
      auditArtifactReadyCount: 0,
      runnerIntentUnlockedCount: 0,
    },
    packets,
  };
}

function resolveSchemaDefinitionBindingReport(report) {
  if (report?.releaseSmokeEvidenceManifestSchemaDefinitionBinding) {
    return report;
  }
  if (report?.releaseSmokeEvidenceManifestSchemaValidatorReadiness) {
    return {
      ...report,
      releaseSmokeEvidenceManifestSchemaDefinitionBinding:
        createSchemaDefinitionBindingFromValidatorReadiness(
          report.releaseSmokeEvidenceManifestSchemaValidatorReadiness,
        ),
    };
  }
  const allGateReport = readJsonOrNull("benchmarks/results/director-agent-os-all-gate-latest.json");
  return {
    ...(allGateReport ?? { suiteId: "director-agent-os-all-gate" }),
    releaseSmokeEvidenceManifestSchemaDefinitionBinding:
      createSchemaDefinitionBindingFromValidatorReadiness(
        allGateReport?.releaseSmokeEvidenceManifestSchemaValidatorReadiness,
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
      report = resolveSchemaDefinitionBindingReport(JSON.parse(readText(item.path)));
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
  `Director Agent OS release smoke evidence manifest schema definition binding gate completed: ${report.status}\n`,
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
    "Director Agent OS release smoke evidence manifest schema definition binding gate failed.",
    [sourceDetails, artifactDetails].filter(Boolean).join("\n"),
  );
}
