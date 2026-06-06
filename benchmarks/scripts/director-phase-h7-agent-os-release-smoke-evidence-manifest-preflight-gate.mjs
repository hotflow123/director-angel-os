import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-h7-agent-os-release-smoke-evidence-manifest-preflight-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "desktop-snapshot-release-smoke-evidence-manifest-preflight",
    path: "apps/director-desktop/src/desktop-system-handlers.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestPreflightAssets(agentOsReleaseSmokeEvidenceIntake)",
      "agentOsReleaseSmokeEvidenceManifestPreflight",
      '"director.desktop.agent-os-release-smoke-evidence-manifest-preflight.v1"',
      "normalizeAgentOsReleaseSmokeEvidenceManifestPreflightReport",
      "normalizeAgentOsReleaseSmokeEvidenceManifestPreflightPacket",
      "manifestSchemaVersion",
      "manifestPathStatus",
      "requiredManifestFields",
      "missingManifestFields",
      "manifestSchemaValid",
      "manifestContentRead",
    ],
  },
  {
    id: "desktop-review-release-smoke-evidence-manifest-preflight-panel",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestPreflightOpsPanel(review?.agentOsReleaseSmokeEvidenceManifestPreflight)",
      "function createAgentOsReleaseSmokeEvidenceManifestPreflightOpsPanel",
      "Agent OS 发布 smoke 证据清单预检",
      "manifest preflight packets",
      "manifestSchemaValid=false",
      "manifestContentRead=false",
      "schema required fields",
      "evidence manifest schema",
      "formatAgentOsReleaseSmokeEvidenceManifestField",
    ],
  },
  {
    id: "desktop-review-release-smoke-evidence-manifest-preflight-structure-test",
    path: "apps/director-desktop/src/app-structure.test.js",
    needles: [
      "createAgentOsReleaseSmokeEvidenceManifestPreflightOpsPanel",
      "formatAgentOsReleaseSmokeEvidenceManifestField",
      "Agent OS 发布 smoke 证据清单预检",
      ".agent-os-release-smoke-evidence-manifest-preflight-panel",
      ".agent-os-release-smoke-evidence-manifest-preflight-packet",
      ".agent-os-release-smoke-evidence-manifest-preflight-fields",
    ],
  },
  {
    id: "desktop-snapshot-release-smoke-evidence-manifest-preflight-test",
    path: "apps/director-desktop/src/desktop-system-handlers.test.js",
    needles: [
      "agentOsReleaseSmokeEvidenceManifestPreflight",
      "director.desktop.agent-os-release-smoke-evidence-manifest-preflight.v1",
      "director.agent-os.release-smoke-evidence-manifest.v1",
      'manifestPathStatus: "missing"',
      "manifestSchemaValid: false",
      "manifestContentRead: false",
      "requiredManifestFields",
      "evidenceManifestPath",
    ],
  },
  {
    id: "desktop-release-smoke-evidence-manifest-preflight-styles",
    path: "apps/director-desktop/src/styles.css",
    needles: [
      ".agent-os-release-smoke-evidence-manifest-preflight-panel",
      ".agent-os-release-smoke-evidence-manifest-preflight-body",
      ".agent-os-release-smoke-evidence-manifest-preflight-packets",
      ".agent-os-release-smoke-evidence-manifest-preflight-packet",
      ".agent-os-release-smoke-evidence-manifest-preflight-fields",
    ],
  },
];

const requiredArtifactCoverage = [
  {
    id: "agent-os-all-latest-release-smoke-evidence-manifest-preflight-artifact",
    path: "benchmarks/results/director-agent-os-all-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-agent-os-all-gate",
      (report) =>
        report?.releaseSmokeEvidenceManifestPreflight?.schemaVersion ===
        "director.agent-os.release-smoke-evidence-manifest-preflight.v1",
      (report) => report?.releaseSmokeEvidenceManifestPreflight?.summary?.packetCount === 7,
      (report) => report?.releaseSmokeEvidenceManifestPreflight?.summary?.blockedCount === 7,
      (report) =>
        report?.releaseSmokeEvidenceManifestPreflight?.summary?.manifestSchemaValidCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestPreflight?.summary?.manifestContentReadCount === 0,
      (report) =>
        report?.releaseSmokeEvidenceManifestPreflight?.summary?.runnerIntentUnlockedCount === 0,
      (report) =>
        (report?.releaseSmokeEvidenceManifestPreflight?.packets ?? []).every(
          (packet) =>
            packet.manifestSchemaVersion ===
              "director.agent-os.release-smoke-evidence-manifest.v1" &&
            packet.manifestPathStatus === "missing" &&
            packet.manifestSchemaValid === false &&
            packet.manifestContentRead === false &&
            packet.remoteManifestAllowed === false &&
            packet.runnerIntentUnlocked === false,
        ),
      (report) =>
        (report?.releaseSmokeEvidenceManifestPreflight?.packets ?? []).some(
          (packet) =>
            packet.id === "live-user-memory-dataset-sweep" &&
            (packet.requiredManifestFields ?? []).includes("dataPolicy") &&
            (packet.requiredManifestFields ?? []).includes("retentionPolicy") &&
            (packet.missingManifestFields ?? []).includes("dataPolicy") &&
            (packet.missingManifestFields ?? []).includes("retentionPolicy"),
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

function resolveManifestPreflightReport(report) {
  if (report?.releaseSmokeEvidenceManifestPreflight) {
    return report;
  }
  if (report?.releaseSmokeEvidenceIntake) {
    return {
      ...report,
      releaseSmokeEvidenceManifestPreflight: createManifestPreflightFromEvidenceIntake(
        report.releaseSmokeEvidenceIntake,
      ),
    };
  }
  const allGateReport = readJsonOrNull("benchmarks/results/director-agent-os-all-gate-latest.json");
  return {
    ...(allGateReport ?? { suiteId: "director-agent-os-all-gate" }),
    releaseSmokeEvidenceManifestPreflight: createManifestPreflightFromEvidenceIntake(
      allGateReport?.releaseSmokeEvidenceIntake,
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
      report = resolveManifestPreflightReport(JSON.parse(readText(item.path)));
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
  `Director Agent OS release smoke evidence manifest preflight gate completed: ${report.status}\n`,
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
    "Director Agent OS release smoke evidence manifest preflight gate failed.",
    [sourceDetails, artifactDetails].filter(Boolean).join("\n"),
  );
}
