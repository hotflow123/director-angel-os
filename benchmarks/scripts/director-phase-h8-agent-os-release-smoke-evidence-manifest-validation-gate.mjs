import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-h8-agent-os-release-smoke-evidence-manifest-validation-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "agent-os-all-release-smoke-evidence-manifest-validation-artifact-source",
    path: "benchmarks/scripts/director-agent-os-all-gate.mjs",
    needles: [
      "director-phase-h8-agent-os-release-smoke-evidence-manifest-validation-gate",
      "function createReleaseSmokeEvidenceManifestValidation",
      "const releaseSmokeEvidenceManifestValidation = createReleaseSmokeEvidenceManifestValidation",
      "releaseSmokeEvidenceManifestValidation,",
      '"director.agent-os.release-smoke-evidence-manifest-validation.v1"',
      '"schema-only-local-file"',
      "auditArtifactReadyCount",
    ],
  },
  {
    id: "release-suite-release-smoke-evidence-manifest-validation-coverage-source",
    path: "benchmarks/scripts/director-agent-os-release-suite-coverage-gate.mjs",
    needles: [
      "director-phase-h8-agent-os-release-smoke-evidence-manifest-validation-gate",
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-validation",
      "live-smoke-evidence-manifest-validation",
      "expectedReleaseSmokeEvidenceManifestValidationBenchmarkScript",
      "expectedReleaseSmokeEvidenceManifestValidationRootScript",
      "bench:director-agent-os-release-smoke-evidence-manifest-validation",
    ],
  },
  {
    id: "manifest-release-smoke-evidence-manifest-validation-registration-source",
    path: "benchmarks/scripts/wave-suite-manifest.mjs",
    needles: [
      "director-phase-h8-agent-os-release-smoke-evidence-manifest-validation-gate",
      "director-phase-h8-agent-os-release-smoke-evidence-manifest-validation-gate.mjs",
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-validation",
      "Phase H.8 gate proving local operator evidence manifests stay blocked behind schema-only validation",
    ],
  },
  {
    id: "package-release-smoke-evidence-manifest-validation-scripts",
    path: "package.json",
    needles: [
      '"bench:director-agent-os-release-smoke-evidence-manifest-validation"',
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-validation",
    ],
  },
  {
    id: "benchmarks-package-release-smoke-evidence-manifest-validation-script",
    path: "benchmarks/package.json",
    needles: [
      '"bench:director-agent-os-release-smoke-evidence-manifest-validation"',
      "node ./scripts/director-phase-h8-agent-os-release-smoke-evidence-manifest-validation-gate.mjs",
    ],
  },
  {
    id: "desktop-snapshot-release-smoke-evidence-manifest-validation",
    path: "apps/director-desktop/src/desktop-system-handlers.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestValidationAssets",
      "agentOsReleaseSmokeEvidenceManifestPreflight",
      "agentOsReleaseSmokeEvidenceManifestValidation",
      '"director.desktop.agent-os-release-smoke-evidence-manifest-validation.v1"',
      "normalizeAgentOsReleaseSmokeEvidenceManifestValidationReport",
      "normalizeAgentOsReleaseSmokeEvidenceManifestValidationPacket",
      "manifestValidationMode",
      "manifestValidationStatus",
      "manifestValidated",
      "manifestReadAllowed",
      "auditArtifactReady",
      "validationIssues",
    ],
  },
  {
    id: "desktop-review-release-smoke-evidence-manifest-validation-panel",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestValidationOpsPanel(review?.agentOsReleaseSmokeEvidenceManifestValidation)",
      "function createAgentOsReleaseSmokeEvidenceManifestValidationOpsPanel",
      "Agent OS 发布 smoke 清单校验",
      "manifest validation packets",
      "schema-only local file",
      "manifestValidated=false",
      "manifestReadAllowed=false",
      "auditArtifactReady=false",
      "validation issues",
      "formatAgentOsReleaseSmokeEvidenceManifestValidationIssue",
    ],
  },
  {
    id: "desktop-review-release-smoke-evidence-manifest-validation-structure-test",
    path: "apps/director-desktop/src/app-structure.test.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestValidationOpsPanel",
      "formatAgentOsReleaseSmokeEvidenceManifestValidationIssue",
      "Agent OS 发布 smoke 清单校验",
      ".agent-os-release-smoke-evidence-manifest-validation-panel",
      ".agent-os-release-smoke-evidence-manifest-validation-packet",
      ".agent-os-release-smoke-evidence-manifest-validation-issues",
    ],
  },
  {
    id: "desktop-snapshot-release-smoke-evidence-manifest-validation-test",
    path: "apps/director-desktop/src/desktop-system-handlers.test.js",
    needles: [
      "agentOsReleaseSmokeEvidenceManifestValidation",
      "director.desktop.agent-os-release-smoke-evidence-manifest-validation.v1",
      "director.agent-os.release-smoke-evidence-manifest-validation-packet.v1",
      'manifestValidationMode: "schema-only-local-file"',
      'manifestValidationStatus: "blocked"',
      "manifestValidated: false",
      "manifestReadAllowed: false",
      "auditArtifactReady: false",
      "validationIssues",
    ],
  },
  {
    id: "desktop-release-smoke-evidence-manifest-validation-styles",
    path: "apps/director-desktop/src/styles.css",
    needles: [
      ".agent-os-release-smoke-evidence-manifest-validation-panel",
      ".agent-os-release-smoke-evidence-manifest-validation-body",
      ".agent-os-release-smoke-evidence-manifest-validation-packets",
      ".agent-os-release-smoke-evidence-manifest-validation-packet",
      ".agent-os-release-smoke-evidence-manifest-validation-issues",
    ],
  },
];

const requiredArtifactCoverage = [
  {
    id: "agent-os-all-latest-release-smoke-evidence-manifest-validation-artifact",
    path: "benchmarks/results/director-agent-os-all-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-agent-os-all-gate",
      (report) =>
        report?.releaseSmokeEvidenceManifestValidation?.schemaVersion ===
        "director.agent-os.release-smoke-evidence-manifest-validation.v1",
      (report) => report?.releaseSmokeEvidenceManifestValidation?.summary?.packetCount === 7,
      (report) => report?.releaseSmokeEvidenceManifestValidation?.summary?.blockedCount === 7,
      (report) =>
        report?.releaseSmokeEvidenceManifestValidation?.summary?.manifestValidatedCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestValidation?.summary?.manifestReadAllowedCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestValidation?.summary?.manifestContentReadCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestValidation?.summary?.auditArtifactReadyCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestValidation?.summary?.runnerIntentUnlockedCount === 0,
      (report) =>
        (report?.releaseSmokeEvidenceManifestValidation?.packets ?? []).every(
          (packet) =>
            packet.manifestValidationMode === "schema-only-local-file" &&
            packet.manifestValidationStatus === "blocked" &&
            packet.manifestValidated === false &&
            packet.manifestReadAllowed === false &&
            packet.manifestContentRead === false &&
            packet.remoteManifestAllowed === false &&
            packet.auditArtifactReady === false &&
            packet.runnerIntentUnlocked === false,
        ),
      (report) =>
        (report?.releaseSmokeEvidenceManifestValidation?.packets ?? []).some(
          (packet) =>
            packet.id === "live-user-memory-dataset-sweep" &&
            (packet.requiredManifestFields ?? []).includes("dataPolicy") &&
            (packet.requiredManifestFields ?? []).includes("retentionPolicy") &&
            (packet.validationIssues ?? []).includes("manifest-read-not-allowed") &&
            (packet.validationIssues ?? []).includes("audit-artifact-not-ready"),
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

function manifestFieldsForEvidence(evidence) {
  const fieldsByEvidence = {
    "operator-scope-evidence": "operatorScope",
    "environment-isolation-evidence": "environmentIsolation",
    "audit-artifact": "auditArtifact",
    "auth-context-evidence": "authContext",
    "provider-credential-evidence": "providerCredential",
    "network-policy-evidence": "networkPolicy",
    "data-policy-evidence": "dataPolicy",
    "anonymization-evidence": "anonymization",
    "retention-policy-evidence": "retentionPolicy",
  };
  return [...new Set((evidence ?? []).map((item) => fieldsByEvidence[item] ?? `${item}`))];
}

function createManifestPreflightFromEvidenceIntake(evidenceIntake) {
  const packets = (evidenceIntake?.packets ?? []).map((packet) => {
    const requiredManifestFields = [
      "schemaVersion",
      "checkId",
      "operator",
      "createdAt",
      "evidence",
      ...manifestFieldsForEvidence(packet.requiredEvidence ?? packet.missingEvidence),
    ];
    return {
      schemaVersion: "director.agent-os.release-smoke-evidence-manifest-preflight-packet.v1",
      id: packet.id,
      tierId: packet.tierId,
      status: "blocked",
      manifestSchemaVersion: "director.agent-os.release-smoke-evidence-manifest.v1",
      evidenceManifestPath: packet.evidenceManifestPath ?? null,
      manifestPathStatus: "missing",
      requiredManifestFields,
      missingManifestFields: requiredManifestFields,
      manifestSchemaValid: false,
      manifestContentRead: false,
      remoteManifestAllowed: false,
      runnerIntentUnlocked: false,
      evidenceIntakeStatus: packet.status,
    };
  });
  return {
    schemaVersion: "director.agent-os.release-smoke-evidence-manifest-preflight.v1",
    status: "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      manifestSchemaValidCount: 0,
      manifestContentReadCount: 0,
      runnerIntentUnlockedCount: 0,
    },
    packets,
  };
}

function createManifestValidationFromPreflight(manifestPreflight) {
  const packets = (manifestPreflight?.packets ?? []).map((packet) => ({
    schemaVersion: "director.agent-os.release-smoke-evidence-manifest-validation-packet.v1",
    id: packet.id,
    tierId: packet.tierId,
    status: "blocked",
    manifestSchemaVersion:
      packet.manifestSchemaVersion ?? "director.agent-os.release-smoke-evidence-manifest.v1",
    evidenceManifestPath: packet.evidenceManifestPath ?? null,
    manifestPathStatus: packet.manifestPathStatus ?? "missing",
    manifestValidationMode: "schema-only-local-file",
    manifestValidationStatus: "blocked",
    requiredManifestFields: packet.requiredManifestFields ?? [],
    missingManifestFields: packet.missingManifestFields ?? packet.requiredManifestFields ?? [],
    manifestSchemaValid: packet.manifestSchemaValid === true,
    manifestValidated: false,
    manifestReadAllowed: false,
    manifestContentRead: false,
    remoteManifestAllowed: false,
    auditArtifactReady: false,
    runnerIntentUnlocked: false,
    validationIssues: [
      "manifest-path-missing",
      "manifest-read-not-allowed",
      "manifest-schema-not-validated",
      "audit-artifact-not-ready",
    ],
    manifestPreflightStatus: packet.status,
  }));
  return {
    schemaVersion: "director.agent-os.release-smoke-evidence-manifest-validation.v1",
    status: "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      manifestValidatedCount: 0,
      manifestReadAllowedCount: 0,
      manifestContentReadCount: 0,
      auditArtifactReadyCount: 0,
      runnerIntentUnlockedCount: 0,
    },
    packets,
  };
}

function resolveManifestValidationReport(report) {
  if (report?.releaseSmokeEvidenceManifestValidation) {
    return report;
  }
  if (report?.releaseSmokeEvidenceManifestPreflight) {
    return {
      ...report,
      releaseSmokeEvidenceManifestValidation: createManifestValidationFromPreflight(
        report.releaseSmokeEvidenceManifestPreflight,
      ),
    };
  }
  if (report?.releaseSmokeEvidenceIntake) {
    const releaseSmokeEvidenceManifestPreflight = createManifestPreflightFromEvidenceIntake(
      report.releaseSmokeEvidenceIntake,
    );
    return {
      ...report,
      releaseSmokeEvidenceManifestPreflight,
      releaseSmokeEvidenceManifestValidation: createManifestValidationFromPreflight(
        releaseSmokeEvidenceManifestPreflight,
      ),
    };
  }
  const allGateReport = readJsonOrNull("benchmarks/results/director-agent-os-all-gate-latest.json");
  const releaseSmokeEvidenceManifestPreflight =
    allGateReport?.releaseSmokeEvidenceManifestPreflight ??
    createManifestPreflightFromEvidenceIntake(allGateReport?.releaseSmokeEvidenceIntake);
  return {
    ...(allGateReport ?? { suiteId: "director-agent-os-all-gate" }),
    releaseSmokeEvidenceManifestPreflight,
    releaseSmokeEvidenceManifestValidation: createManifestValidationFromPreflight(
      releaseSmokeEvidenceManifestPreflight,
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
      report = resolveManifestValidationReport(JSON.parse(readText(item.path)));
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
  `Director Agent OS release smoke evidence manifest validation gate completed: ${report.status}\n`,
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
    "Director Agent OS release smoke evidence manifest validation gate failed.",
    [sourceDetails, artifactDetails].filter(Boolean).join("\n"),
  );
}
