import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-i2-agent-os-desktop-smoke-manual-run-artifact-validator-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const desktopSmokeEvidenceArtifactRelativePath =
  "benchmarks/results/director-agent-os-desktop-smoke-evidence-artifact-latest.json";
const desktopSmokeManualRunArtifactValidatorRelativePath =
  "benchmarks/results/director-agent-os-desktop-smoke-manual-run-artifact-validator-latest.json";

const requiredSourceCoverage = [
  {
    id: "agent-os-all-desktop-smoke-manual-run-artifact-validator-source",
    path: "benchmarks/scripts/director-agent-os-all-gate.mjs",
    needles: [
      "director-phase-i2-agent-os-desktop-smoke-manual-run-artifact-validator-gate",
      "function createDesktopSmokeManualRunArtifactValidator",
      "const desktopSmokeManualRunArtifactValidator",
      "desktopSmokeManualRunArtifactValidator,",
      "desktopSmokeManualRunArtifactValidatorPath",
      '"director.agent-os.desktop-smoke-manual-run-artifact-validator.v1"',
      '"schema-path-signing-revocation-local-dry-run"',
      'manualRunStatus: "operator-action-required"',
      "runnerIntentRevocationStatus",
      "rejectedUnsafeMutationCount",
    ],
  },
  {
    id: "release-suite-desktop-smoke-manual-run-artifact-validator-coverage-source",
    path: "benchmarks/scripts/director-agent-os-release-suite-coverage-gate.mjs",
    needles: [
      "director-phase-i2-agent-os-desktop-smoke-manual-run-artifact-validator-gate",
      "pnpm --dir benchmarks bench:director-agent-os-desktop-smoke-manual-run-artifact-validator",
      "desktop-smoke-manual-run-artifact-validator",
      "expectedDesktopSmokeManualRunArtifactValidatorBenchmarkScript",
      "expectedDesktopSmokeManualRunArtifactValidatorRootScript",
      "bench:director-agent-os-desktop-smoke-manual-run-artifact-validator",
    ],
  },
  {
    id: "manifest-desktop-smoke-manual-run-artifact-validator-registration-source",
    path: "benchmarks/scripts/wave-suite-manifest.mjs",
    needles: [
      "director-phase-i2-agent-os-desktop-smoke-manual-run-artifact-validator-gate",
      "director-phase-i2-agent-os-desktop-smoke-manual-run-artifact-validator-gate.mjs",
      "pnpm --dir benchmarks bench:director-agent-os-desktop-smoke-manual-run-artifact-validator",
      "Phase I.2 gate proving the desktop smoke manual-run artifact validator checks schema, path, signing, and revocation state",
    ],
  },
  {
    id: "package-desktop-smoke-manual-run-artifact-validator-scripts",
    path: "package.json",
    needles: [
      '"bench:director-agent-os-desktop-smoke-manual-run-artifact-validator"',
      "pnpm --dir benchmarks bench:director-agent-os-desktop-smoke-manual-run-artifact-validator",
    ],
  },
  {
    id: "benchmarks-package-desktop-smoke-manual-run-artifact-validator-script",
    path: "benchmarks/package.json",
    needles: [
      '"bench:director-agent-os-desktop-smoke-manual-run-artifact-validator"',
      "node ./scripts/director-phase-i2-agent-os-desktop-smoke-manual-run-artifact-validator-gate.mjs",
    ],
  },
  {
    id: "readme-desktop-smoke-manual-run-artifact-validator-docs",
    path: "benchmarks/README.md",
    needles: [
      "pnpm bench:director-agent-os-desktop-smoke-manual-run-artifact-validator",
      "Phase I.2 gate proving the desktop smoke manual-run artifact validator checks schema, path, signing, and revocation state",
    ],
  },
  {
    id: "remaining-execution-desktop-smoke-manual-run-artifact-validator-plan",
    path: "docs/plans/_active-execution/director-angel-remaining-execution.md",
    needles: [
      "I.2 桌面 smoke 手动运行 checklist + artifact validator",
      "operator 手动启动桌面并提供 artifact",
      "不自动点击桌面",
      "不读取显式 dry-run artifact 之外的 manifest 内容",
      "不自动启动 runner",
    ],
  },
];

function readText(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function readJsonOrNull(path) {
  try {
    return JSON.parse(readText(path));
  } catch {
    return null;
  }
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function readArtifactWithHash(relativePath) {
  try {
    const text = readText(relativePath);
    return {
      artifact: JSON.parse(text),
      artifactSha256: sha256(text),
      artifactLoadError: null,
    };
  } catch (error) {
    return {
      artifact: null,
      artifactSha256: null,
      artifactLoadError: error instanceof Error ? error.message : String(error),
    };
  }
}

function createFailClosedRunnerIntentPacket() {
  return {
    schemaVersion: "director.agent-os.release-smoke-runner-intent-signing-revocation-packet.v1",
    id: "real-desktop-device-release-smoke",
    tierId: "smoke",
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
    auditArtifactReadinessReady: false,
    auditArtifactReady: false,
    manifestContentRead: false,
  };
}

function resolveRunnerIntentPacket(report) {
  const packets = report?.releaseSmokeRunnerIntentSigningRevocation?.packets ?? [];
  return (
    packets.find((packet) => packet.id === "real-desktop-device-release-smoke") ??
    createFailClosedRunnerIntentPacket()
  );
}

function check(id, passed, detail) {
  return {
    id,
    status: passed ? "passed" : "failed",
    detail,
  };
}

function isAllowedArtifactPath(relativePath) {
  return (
    relativePath === desktopSmokeEvidenceArtifactRelativePath &&
    !relativePath.startsWith("/") &&
    !relativePath.includes("..") &&
    !relativePath.includes("://")
  );
}

function validateDesktopSmokeManualRunArtifact({
  artifact,
  artifactRelativePath,
  runnerIntentPacket,
  artifactSha256 = null,
  artifactLoadError = null,
}) {
  const checks = [
    check(
      "artifact-load",
      artifact !== null && artifactLoadError === null,
      artifactLoadError ?? "desktop smoke dry-run artifact loaded",
    ),
    check(
      "artifact-schema",
      artifact?.schemaVersion === "director.agent-os.desktop-smoke-evidence-artifact-file.v1",
      "expected desktop smoke evidence artifact file schema",
    ),
    check(
      "artifact-path",
      isAllowedArtifactPath(artifactRelativePath),
      "artifact must stay on the local operator-owned dry-run results path",
    ),
    check(
      "artifact-mode",
      artifact?.artifactMode === "local-operator-owned-dry-run-metadata" &&
        artifact?.dryRunOnly === true &&
        artifact?.localOnly === true &&
        artifact?.operatorOwned === true,
      "artifact must be local operator-owned dry-run metadata",
    ),
    check(
      "desktop-check-id",
      artifact?.checkId === "real-desktop-device-release-smoke" && artifact?.tierId === "smoke",
      "artifact must target the real desktop release smoke check without executing it",
    ),
    check(
      "no-user-data-read",
      artifact?.userDataRead === false && artifact?.noUserDataGuarantee === true,
      "validator must reject artifacts that read user data",
    ),
    check(
      "manifest-content-not-read",
      artifact?.manifestContentRead === false,
      "validator must not read manifest content beyond the explicit dry-run artifact",
    ),
    check(
      "no-automation-started",
      artifact?.desktopAutomationStarted === false &&
        artifact?.weixinAutomationStarted === false &&
        artifact?.providerAutomationStarted === false &&
        artifact?.browserAutomationStarted === false,
      "validator must reject artifacts that started desktop, Weixin, provider, or browser automation",
    ),
    check(
      "live-runner-not-started",
      artifact?.liveRunnerStarted === false,
      "validator must reject artifacts that started a live runner",
    ),
    check(
      "runner-intent-locked",
      artifact?.runnerIntentUnlocked === false &&
        artifact?.runnerIntentTokenIssued === false &&
        artifact?.runnerIntentSigned === false,
      "artifact must not unlock, issue, or sign runner intent",
    ),
    check(
      "runner-intent-signing-fail-closed",
      runnerIntentPacket?.runnerIntentSigned === false &&
        runnerIntentPacket?.runnerIntentSignatureReady === false &&
        runnerIntentPacket?.runnerIntentTokenIssued === false &&
        runnerIntentPacket?.runnerIntentUnlocked === false,
      "runner intent signing state must stay fail-closed",
    ),
    check(
      "runner-intent-revoked",
      runnerIntentPacket?.runnerIntentRevocationStatus === "revoked",
      "runner intent revocation state must stay revoked until a later explicit operator unlock",
    ),
    check(
      "next-step-binding",
      artifact?.nextStep === "desktop-smoke-manual-run-checklist-artifact-validator",
      "I.1 artifact must bind forward to the manual-run artifact validator",
    ),
  ];
  const failedChecks = checks.filter((item) => item.status !== "passed");
  return {
    schemaVersion: "director.agent-os.desktop-smoke-manual-run-artifact-validation.v1",
    status: failedChecks.length === 0 ? "passed" : "failed",
    artifactRelativePath,
    artifactSha256,
    runnerIntentRevocationStatus: runnerIntentPacket?.runnerIntentRevocationStatus ?? "missing",
    runnerIntentSigned: runnerIntentPacket?.runnerIntentSigned === true,
    runnerIntentSignatureReady: runnerIntentPacket?.runnerIntentSignatureReady === true,
    runnerIntentTokenIssued: runnerIntentPacket?.runnerIntentTokenIssued === true,
    runnerIntentUnlocked: runnerIntentPacket?.runnerIntentUnlocked === true,
    checks,
    failedChecks: failedChecks.map((item) => item.id),
  };
}

function createUnsafeMutationCases(artifact, runnerIntentPacket) {
  return [
    {
      id: "reject-user-data-read",
      artifact: { ...artifact, userDataRead: true },
      artifactRelativePath: desktopSmokeEvidenceArtifactRelativePath,
      runnerIntentPacket,
    },
    {
      id: "reject-manifest-content-read",
      artifact: { ...artifact, manifestContentRead: true },
      artifactRelativePath: desktopSmokeEvidenceArtifactRelativePath,
      runnerIntentPacket,
    },
    {
      id: "reject-desktop-automation-started",
      artifact: { ...artifact, desktopAutomationStarted: true },
      artifactRelativePath: desktopSmokeEvidenceArtifactRelativePath,
      runnerIntentPacket,
    },
    {
      id: "reject-live-runner-started",
      artifact: { ...artifact, liveRunnerStarted: true },
      artifactRelativePath: desktopSmokeEvidenceArtifactRelativePath,
      runnerIntentPacket,
    },
    {
      id: "reject-runner-token-issued",
      artifact,
      artifactRelativePath: desktopSmokeEvidenceArtifactRelativePath,
      runnerIntentPacket: { ...runnerIntentPacket, runnerIntentTokenIssued: true },
    },
    {
      id: "reject-runner-intent-signed",
      artifact,
      artifactRelativePath: desktopSmokeEvidenceArtifactRelativePath,
      runnerIntentPacket: { ...runnerIntentPacket, runnerIntentSigned: true },
    },
    {
      id: "reject-runner-intent-unlocked",
      artifact,
      artifactRelativePath: desktopSmokeEvidenceArtifactRelativePath,
      runnerIntentPacket: { ...runnerIntentPacket, runnerIntentUnlocked: true },
    },
    {
      id: "reject-revocation-not-revoked",
      artifact,
      artifactRelativePath: desktopSmokeEvidenceArtifactRelativePath,
      runnerIntentPacket: { ...runnerIntentPacket, runnerIntentRevocationStatus: "missing" },
    },
    {
      id: "reject-path-traversal",
      artifact,
      artifactRelativePath: "../secret-user-data.json",
      runnerIntentPacket,
    },
    {
      id: "reject-remote-artifact-path",
      artifact,
      artifactRelativePath: "https://example.invalid/desktop-smoke.json",
      runnerIntentPacket,
    },
  ];
}

function createDesktopSmokeManualRunArtifactValidator({
  artifact,
  artifactSha256,
  artifactLoadError,
  runnerIntentPacket,
}) {
  const validation = validateDesktopSmokeManualRunArtifact({
    artifact,
    artifactRelativePath: desktopSmokeEvidenceArtifactRelativePath,
    artifactSha256,
    artifactLoadError,
    runnerIntentPacket,
  });
  const unsafeMutationResults =
    artifact === null
      ? []
      : createUnsafeMutationCases(artifact, runnerIntentPacket).map((fixture) => {
          const result = validateDesktopSmokeManualRunArtifact({
            artifact: fixture.artifact,
            artifactRelativePath: fixture.artifactRelativePath,
            runnerIntentPacket: fixture.runnerIntentPacket,
          });
          return {
            id: fixture.id,
            status: result.status === "failed" ? "rejected" : "accepted",
            failedChecks: result.failedChecks,
          };
        });
  const acceptedUnsafeMutationResults = unsafeMutationResults.filter(
    (result) => result.status !== "rejected",
  );
  return {
    schemaVersion: "director.agent-os.desktop-smoke-manual-run-artifact-validator.v1",
    status:
      validation.status === "passed" && acceptedUnsafeMutationResults.length === 0
        ? "ready"
        : "failed",
    validatorMode: "schema-path-signing-revocation-local-dry-run",
    manualRunStatus: "operator-action-required",
    artifactPath: resolve(repoRoot, desktopSmokeManualRunArtifactValidatorRelativePath),
    artifactRelativePath: desktopSmokeManualRunArtifactValidatorRelativePath,
    validatedArtifactPath: resolve(repoRoot, desktopSmokeEvidenceArtifactRelativePath),
    validatedArtifactRelativePath: desktopSmokeEvidenceArtifactRelativePath,
    manualRunChecklist: [
      {
        id: "operator-start-desktop-manually",
        status: "operator-owned",
        automaticDesktopClicking: false,
        desktopAutomationStarted: false,
      },
      {
        id: "operator-provides-local-dry-run-artifact",
        status: validation.status === "passed" ? "validated" : "blocked",
        manifestContentRead: false,
        userDataRead: false,
      },
      {
        id: "validator-checks-signing-and-revocation",
        status:
          validation.runnerIntentRevocationStatus === "revoked" &&
          validation.runnerIntentTokenIssued === false &&
          validation.runnerIntentSigned === false &&
          validation.runnerIntentUnlocked === false
            ? "validated"
            : "blocked",
        runnerIntentRevocationStatus: validation.runnerIntentRevocationStatus,
        runnerIntentTokenIssued: validation.runnerIntentTokenIssued,
        runnerIntentSigned: validation.runnerIntentSigned,
        runnerIntentUnlocked: validation.runnerIntentUnlocked,
      },
    ],
    summary: {
      validatedArtifactCount: validation.status === "passed" ? 1 : 0,
      validationIssueCount: validation.failedChecks.length,
      checklistItemCount: 3,
      operatorManualActionCount: 1,
      rejectedUnsafeMutationCount: unsafeMutationResults.filter(
        (result) => result.status === "rejected",
      ).length,
      acceptedUnsafeMutationCount: acceptedUnsafeMutationResults.length,
      userDataReadCount: artifact?.userDataRead === true ? 1 : 0,
      manifestContentReadCount: artifact?.manifestContentRead === true ? 1 : 0,
      desktopAutomationStartedCount: artifact?.desktopAutomationStarted === true ? 1 : 0,
      weixinAutomationStartedCount: artifact?.weixinAutomationStarted === true ? 1 : 0,
      providerAutomationStartedCount: artifact?.providerAutomationStarted === true ? 1 : 0,
      browserAutomationStartedCount: artifact?.browserAutomationStarted === true ? 1 : 0,
      liveRunnerStartedCount: artifact?.liveRunnerStarted === true ? 1 : 0,
      runnerIntentTokenIssuedCount: validation.runnerIntentTokenIssued ? 1 : 0,
      runnerIntentSignedCount: validation.runnerIntentSigned ? 1 : 0,
      runnerIntentUnlockedCount: validation.runnerIntentUnlocked ? 1 : 0,
      runnerIntentRevokedCount: validation.runnerIntentRevocationStatus === "revoked" ? 1 : 0,
    },
    validation,
    unsafeMutationResults,
  };
}

const requiredArtifactCoverage = [
  {
    id: "desktop-smoke-manual-run-artifact-validator-positive-and-negative-cases",
    createSubject: () => {
      const artifactWithHash = readArtifactWithHash(desktopSmokeEvidenceArtifactRelativePath);
      const allGateReport = readJsonOrNull(
        "benchmarks/results/director-agent-os-all-gate-latest.json",
      );
      return createDesktopSmokeManualRunArtifactValidator({
        ...artifactWithHash,
        runnerIntentPacket: resolveRunnerIntentPacket(allGateReport),
      });
    },
    checks: [
      (report) =>
        report?.schemaVersion ===
        "director.agent-os.desktop-smoke-manual-run-artifact-validator.v1",
      (report) => report?.status === "ready",
      (report) => report?.validatorMode === "schema-path-signing-revocation-local-dry-run",
      (report) => report?.manualRunStatus === "operator-action-required",
      (report) => report?.summary?.validatedArtifactCount === 1,
      (report) => report?.summary?.validationIssueCount === 0,
      (report) => report?.summary?.checklistItemCount === 3,
      (report) => report?.summary?.operatorManualActionCount === 1,
      (report) => report?.summary?.rejectedUnsafeMutationCount === 10,
      (report) => report?.summary?.acceptedUnsafeMutationCount === 0,
      (report) => report?.summary?.userDataReadCount === 0,
      (report) => report?.summary?.manifestContentReadCount === 0,
      (report) => report?.summary?.desktopAutomationStartedCount === 0,
      (report) => report?.summary?.weixinAutomationStartedCount === 0,
      (report) => report?.summary?.providerAutomationStartedCount === 0,
      (report) => report?.summary?.browserAutomationStartedCount === 0,
      (report) => report?.summary?.liveRunnerStartedCount === 0,
      (report) => report?.summary?.runnerIntentTokenIssuedCount === 0,
      (report) => report?.summary?.runnerIntentSignedCount === 0,
      (report) => report?.summary?.runnerIntentUnlockedCount === 0,
      (report) => report?.summary?.runnerIntentRevokedCount === 1,
      (report) =>
        report?.validatedArtifactRelativePath === desktopSmokeEvidenceArtifactRelativePath,
      (report) =>
        report?.artifactRelativePath === desktopSmokeManualRunArtifactValidatorRelativePath,
      (report) =>
        (report?.manualRunChecklist ?? []).every(
          (item) =>
            item.automaticDesktopClicking !== true &&
            item.desktopAutomationStarted !== true &&
            item.userDataRead !== true &&
            item.manifestContentRead !== true,
        ),
      (report) =>
        (report?.unsafeMutationResults ?? []).every((result) => result.status === "rejected"),
    ],
  },
];

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
    const subject = item.createSubject();
    const failedChecks = item.checks
      .map((checkItem, index) => ({ index, passed: checkItem(subject) }))
      .filter((checkItem) => !checkItem.passed)
      .map((checkItem) => `check-${checkItem.index}`);
    return {
      id: item.id,
      status: failedChecks.length === 0 ? "passed" : "failed",
      failedChecks,
      subject,
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
const validatorArtifact = artifactCoverage[0]?.subject ?? null;
if (validatorArtifact !== null) {
  writeFileSync(
    resolve(repoRoot, desktopSmokeManualRunArtifactValidatorRelativePath),
    `${JSON.stringify(validatorArtifact, null, 2)}\n`,
    "utf8",
  );
}
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
  `Director Agent OS desktop smoke manual-run artifact validator gate completed: ${report.status}\n`,
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
    .map((result) => `${result.id} failed ${result.failedChecks.join(", ")}`)
    .join("\n");
  fail(
    "Director Agent OS desktop smoke manual-run artifact validator gate failed.",
    [sourceDetails, artifactDetails].filter(Boolean).join("\n"),
  );
}
