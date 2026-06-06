import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-h14-agent-os-release-smoke-runner-intent-signing-revocation-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "agent-os-all-release-smoke-runner-intent-signing-revocation-artifact-source",
    path: "benchmarks/scripts/director-agent-os-all-gate.mjs",
    needles: [
      "director-phase-h14-agent-os-release-smoke-runner-intent-signing-revocation-gate",
      "function createReleaseSmokeRunnerIntentSigningRevocation",
      "const releaseSmokeRunnerIntentSigningRevocation",
      "releaseSmokeRunnerIntentSigningRevocation,",
      '"director.agent-os.release-smoke-runner-intent-signing-revocation.v1"',
      '"fail-closed-runner-intent-signing-revocation"',
      "runnerIntentSignatureReadyCount",
      "runnerIntentTokenIssuedCount",
    ],
  },
  {
    id: "release-suite-release-smoke-runner-intent-signing-revocation-coverage-source",
    path: "benchmarks/scripts/director-agent-os-release-suite-coverage-gate.mjs",
    needles: [
      "director-phase-h14-agent-os-release-smoke-runner-intent-signing-revocation-gate",
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-runner-intent-signing-revocation",
      "live-smoke-runner-intent-signing-revocation",
      "expectedReleaseSmokeRunnerIntentSigningRevocationBenchmarkScript",
      "expectedReleaseSmokeRunnerIntentSigningRevocationRootScript",
      "bench:director-agent-os-release-smoke-runner-intent-signing-revocation",
    ],
  },
  {
    id: "manifest-release-smoke-runner-intent-signing-revocation-registration-source",
    path: "benchmarks/scripts/wave-suite-manifest.mjs",
    needles: [
      "director-phase-h14-agent-os-release-smoke-runner-intent-signing-revocation-gate",
      "director-phase-h14-agent-os-release-smoke-runner-intent-signing-revocation-gate.mjs",
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-runner-intent-signing-revocation",
      "Phase H.14 gate proving runner intent signing and revocation stay fail-closed until signing key, signature, revocation record, audit artifact readiness, and manifest content read state",
    ],
  },
  {
    id: "package-release-smoke-runner-intent-signing-revocation-scripts",
    path: "package.json",
    needles: [
      '"bench:director-agent-os-release-smoke-runner-intent-signing-revocation"',
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-runner-intent-signing-revocation",
    ],
  },
  {
    id: "benchmarks-package-release-smoke-runner-intent-signing-revocation-script",
    path: "benchmarks/package.json",
    needles: [
      '"bench:director-agent-os-release-smoke-runner-intent-signing-revocation"',
      "node ./scripts/director-phase-h14-agent-os-release-smoke-runner-intent-signing-revocation-gate.mjs",
    ],
  },
  {
    id: "desktop-snapshot-release-smoke-runner-intent-signing-revocation",
    path: "apps/director-desktop/src/desktop-system-handlers.js",
    needles: [
      "createAgentOsReleaseSmokeRunnerIntentSigningRevocationAssets",
      "agentOsReleaseSmokeRunnerIntentSigningRevocation",
      '"director.desktop.agent-os-release-smoke-runner-intent-signing-revocation.v1"',
      "normalizeAgentOsReleaseSmokeRunnerIntentSigningRevocationReport",
      "normalizeAgentOsReleaseSmokeRunnerIntentSigningRevocationPacket",
      "runnerIntentContractMode",
      "runnerIntentSignatureReady",
      "runnerIntentTokenIssued",
      "runnerIntentSigningRevocationIssues",
    ],
  },
  {
    id: "desktop-review-release-smoke-runner-intent-signing-revocation-panel",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "createAgentOsReleaseSmokeRunnerIntentSigningRevocationOpsPanel(review?.agentOsReleaseSmokeRunnerIntentSigningRevocation)",
      "function createAgentOsReleaseSmokeRunnerIntentSigningRevocationOpsPanel",
      "Agent OS 发布 smoke runner intent 签发/撤销",
      "runner intent signing/revocation packets",
      "fail-closed runner intent signing/revocation",
      "runnerIntentSigned=false",
      "runnerIntentSignatureReady=false",
      "runnerIntentTokenIssued=false",
      "runner intent signing/revocation issues",
      "formatAgentOsReleaseSmokeRunnerIntentSigningRevocationIssue",
    ],
  },
  {
    id: "desktop-review-release-smoke-runner-intent-signing-revocation-structure-test",
    path: "apps/director-desktop/src/app-structure.test.js",
    needles: [
      "createAgentOsReleaseSmokeRunnerIntentSigningRevocationOpsPanel",
      "formatAgentOsReleaseSmokeRunnerIntentSigningRevocationIssue",
      "Agent OS 发布 smoke runner intent 签发/撤销",
      ".agent-os-release-smoke-runner-intent-signing-revocation-panel",
      ".agent-os-release-smoke-runner-intent-signing-revocation-packet",
      ".agent-os-release-smoke-runner-intent-signing-revocation-issues",
    ],
  },
  {
    id: "desktop-snapshot-release-smoke-runner-intent-signing-revocation-test",
    path: "apps/director-desktop/src/desktop-system-handlers.test.js",
    needles: [
      "agentOsReleaseSmokeRunnerIntentSigningRevocation",
      "director.desktop.agent-os-release-smoke-runner-intent-signing-revocation.v1",
      "director.agent-os.release-smoke-runner-intent-signing-revocation-packet.v1",
      'runnerIntentContractMode: "fail-closed-runner-intent-signing-revocation"',
      'runnerIntentSigningStatus: "blocked"',
      'runnerIntentRevocationStatus: "revoked"',
      "runnerIntentSigned: false",
      "runnerIntentSignatureReady: false",
      "runnerIntentTokenIssued: false",
      "runnerIntentSigningRevocationIssues",
    ],
  },
  {
    id: "desktop-release-smoke-runner-intent-signing-revocation-styles",
    path: "apps/director-desktop/src/styles.css",
    needles: [
      ".agent-os-release-smoke-runner-intent-signing-revocation-panel",
      ".agent-os-release-smoke-runner-intent-signing-revocation-body",
      ".agent-os-release-smoke-runner-intent-signing-revocation-packets",
      ".agent-os-release-smoke-runner-intent-signing-revocation-packet",
      ".agent-os-release-smoke-runner-intent-signing-revocation-issues",
    ],
  },
];

const requiredArtifactCoverage = [
  {
    id: "agent-os-all-latest-release-smoke-runner-intent-signing-revocation-artifact",
    path: "benchmarks/results/director-agent-os-all-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-agent-os-all-gate",
      (report) =>
        report?.releaseSmokeRunnerIntentSigningRevocation?.schemaVersion ===
        "director.agent-os.release-smoke-runner-intent-signing-revocation.v1",
      (report) => report?.releaseSmokeRunnerIntentSigningRevocation?.summary?.packetCount === 7,
      (report) => report?.releaseSmokeRunnerIntentSigningRevocation?.summary?.blockedCount === 7,
      (report) =>
        report?.releaseSmokeRunnerIntentSigningRevocation?.summary?.runnerIntentSignedCount === 0,
      (report) =>
        report?.releaseSmokeRunnerIntentSigningRevocation?.summary
          ?.runnerIntentSignatureReadyCount === 0,
      (report) =>
        report?.releaseSmokeRunnerIntentSigningRevocation?.summary?.runnerIntentTokenIssuedCount ===
        0,
      (report) =>
        report?.releaseSmokeRunnerIntentSigningRevocation?.summary?.runnerIntentUnlockedCount === 0,
      (report) =>
        report?.releaseSmokeRunnerIntentSigningRevocation?.summary?.runnerIntentRevokedCount === 7,
      (report) =>
        report?.releaseSmokeRunnerIntentSigningRevocation?.summary
          ?.auditArtifactReadinessReadyCount === 0,
      (report) =>
        report?.releaseSmokeRunnerIntentSigningRevocation?.summary?.manifestContentReadCount === 0,
      (report) =>
        (report?.releaseSmokeRunnerIntentSigningRevocation?.packets ?? []).every(
          (packet) =>
            packet.runnerIntentContractMode === "fail-closed-runner-intent-signing-revocation" &&
            packet.runnerIntentSigningStatus === "blocked" &&
            packet.runnerIntentRevocationStatus === "revoked" &&
            packet.runnerIntentSigned === false &&
            packet.runnerIntentSignatureReady === false &&
            packet.runnerIntentTokenIssued === false &&
            packet.runnerIntentSignature === null &&
            packet.runnerIntentSigningKeyRef === null &&
            packet.runnerIntentRevocationRecordPath === null &&
            packet.runnerIntentUnlocked === false &&
            packet.auditArtifactReadinessReady === false &&
            packet.manifestContentRead === false,
        ),
      (report) =>
        (report?.releaseSmokeRunnerIntentSigningRevocation?.packets ?? []).some(
          (packet) =>
            packet.id === "live-user-memory-dataset-sweep" &&
            packet.tierId === "real-data" &&
            packet.auditArtifactReadinessStatus === "blocked" &&
            (packet.runnerIntentSigningRevocationIssues ?? []).includes(
              "runner-intent-signing-key-missing",
            ) &&
            (packet.runnerIntentSigningRevocationIssues ?? []).includes(
              "runner-intent-signature-not-issued",
            ) &&
            (packet.runnerIntentSigningRevocationIssues ?? []).includes(
              "runner-intent-revocation-record-missing",
            ) &&
            (packet.runnerIntentSigningRevocationIssues ?? []).includes(
              "audit-artifact-readiness-not-ready",
            ) &&
            (packet.runnerIntentSigningRevocationIssues ?? []).includes(
              "manifest-content-not-read",
            ) &&
            (packet.runnerIntentSigningRevocationIssues ?? []).includes("runner-intent-locked"),
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

function createRunnerIntentSigningRevocationFromAuditArtifactReadiness(auditArtifactReadiness) {
  const packets = (auditArtifactReadiness?.packets ?? []).map((packet) => ({
    schemaVersion: "director.agent-os.release-smoke-runner-intent-signing-revocation-packet.v1",
    id: packet.id,
    tierId: packet.tierId,
    status: "blocked",
    runnerIntentContractMode: "fail-closed-runner-intent-signing-revocation",
    runnerIntentSigningStatus: "blocked",
    runnerIntentRevocationStatus: "revoked",
    runnerIntentSigned: false,
    runnerIntentSignatureReady: false,
    runnerIntentTokenIssued: false,
    runnerIntentSignature: null,
    runnerIntentSigningKeyRef: null,
    runnerIntentRevocationRecordPath: null,
    runnerIntentUnlocked: false,
    auditArtifactReadinessReady: packet.auditArtifactReadinessReady === true,
    auditArtifactReady: false,
    manifestContentRead: false,
    runnerIntentSigningRevocationIssues: [
      "runner-intent-signing-key-missing",
      "runner-intent-signature-not-issued",
      "runner-intent-revocation-record-missing",
      "audit-artifact-readiness-not-ready",
      "manifest-content-not-read",
      "runner-intent-locked",
    ],
    auditArtifactReadinessStatus: packet.auditArtifactReadinessStatus ?? packet.status,
  }));
  return {
    schemaVersion: "director.agent-os.release-smoke-runner-intent-signing-revocation.v1",
    status: "blocked",
    summary: {
      packetCount: packets.length,
      blockedCount: packets.filter((packet) => packet.status === "blocked").length,
      runnerIntentSignedCount: 0,
      runnerIntentSignatureReadyCount: 0,
      runnerIntentTokenIssuedCount: 0,
      runnerIntentUnlockedCount: 0,
      runnerIntentRevokedCount: packets.filter(
        (packet) => packet.runnerIntentRevocationStatus === "revoked",
      ).length,
      auditArtifactReadinessReadyCount: 0,
      manifestContentReadCount: 0,
    },
    packets,
  };
}

function resolveRunnerIntentSigningRevocationReport(report) {
  if (report?.releaseSmokeRunnerIntentSigningRevocation) {
    return report;
  }
  if (report?.releaseSmokeEvidenceManifestAuditArtifactReadiness) {
    return {
      ...report,
      releaseSmokeRunnerIntentSigningRevocation:
        createRunnerIntentSigningRevocationFromAuditArtifactReadiness(
          report.releaseSmokeEvidenceManifestAuditArtifactReadiness,
        ),
    };
  }
  const allGateReport = readJsonOrNull("benchmarks/results/director-agent-os-all-gate-latest.json");
  return {
    ...(allGateReport ?? { suiteId: "director-agent-os-all-gate" }),
    releaseSmokeRunnerIntentSigningRevocation:
      createRunnerIntentSigningRevocationFromAuditArtifactReadiness(
        allGateReport?.releaseSmokeEvidenceManifestAuditArtifactReadiness,
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
      report = resolveRunnerIntentSigningRevocationReport(JSON.parse(readText(item.path)));
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
  `Director Agent OS release smoke runner intent signing/revocation gate completed: ${report.status}\n`,
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
    "Director Agent OS release smoke runner intent signing/revocation gate failed.",
    [sourceDetails, artifactDetails].filter(Boolean).join("\n"),
  );
}
