import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-i3-agent-os-non-voice-provider-smoke-candidate-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const artifactRelativePath =
  "benchmarks/results/director-agent-os-non-voice-provider-smoke-candidate-latest.json";

const requiredSourceCoverage = [
  {
    id: "agent-os-all-non-voice-provider-smoke-candidate-source",
    path: "benchmarks/scripts/director-agent-os-all-gate.mjs",
    needles: [
      "director-phase-i3-agent-os-non-voice-provider-smoke-candidate-gate",
      "function createNonVoiceProviderSmokeCandidate",
      "const nonVoiceProviderSmokeCandidate",
      "nonVoiceProviderSmokeCandidate,",
      "nonVoiceProviderSmokeCandidatePath",
      '"director.agent-os.non-voice-provider-smoke-candidate.v1"',
      '"media-understanding.local"',
      '"media-understanding"',
      '"local-metadata-dry-run"',
      "sandboxBackendAdmissionEvidence",
      "runnerIntentRevocationStatus",
      "providerCredentialsUsed: false",
      "networkUsed: false",
      "liveRunnerStarted: false",
    ],
  },
  {
    id: "release-suite-non-voice-provider-smoke-candidate-coverage-source",
    path: "benchmarks/scripts/director-agent-os-release-suite-coverage-gate.mjs",
    needles: [
      "director-phase-i3-agent-os-non-voice-provider-smoke-candidate-gate",
      "pnpm --dir benchmarks bench:director-agent-os-non-voice-provider-smoke-candidate",
      "non-voice-provider-smoke-candidate",
      "expectedNonVoiceProviderSmokeCandidateBenchmarkScript",
      "expectedNonVoiceProviderSmokeCandidateRootScript",
      "bench:director-agent-os-non-voice-provider-smoke-candidate",
    ],
  },
  {
    id: "manifest-non-voice-provider-smoke-candidate-registration-source",
    path: "benchmarks/scripts/wave-suite-manifest.mjs",
    needles: [
      "director-phase-i3-agent-os-non-voice-provider-smoke-candidate-gate",
      "director-phase-i3-agent-os-non-voice-provider-smoke-candidate-gate.mjs",
      "pnpm --dir benchmarks bench:director-agent-os-non-voice-provider-smoke-candidate",
      "Phase I.3 gate proving the non-voice provider smoke candidate uses media-understanding.local",
    ],
  },
  {
    id: "package-non-voice-provider-smoke-candidate-scripts",
    path: "package.json",
    needles: [
      '"bench:director-agent-os-non-voice-provider-smoke-candidate"',
      "pnpm --dir benchmarks bench:director-agent-os-non-voice-provider-smoke-candidate",
    ],
  },
  {
    id: "benchmarks-package-non-voice-provider-smoke-candidate-script",
    path: "benchmarks/package.json",
    needles: [
      '"bench:director-agent-os-non-voice-provider-smoke-candidate"',
      "node ./scripts/director-phase-i3-agent-os-non-voice-provider-smoke-candidate-gate.mjs",
    ],
  },
  {
    id: "readme-non-voice-provider-smoke-candidate-docs",
    path: "benchmarks/README.md",
    needles: [
      "pnpm bench:director-agent-os-non-voice-provider-smoke-candidate",
      "Phase I.3 gate proving the non-voice provider smoke candidate uses media-understanding.local",
    ],
  },
  {
    id: "remaining-execution-non-voice-provider-smoke-candidate-plan",
    path: "docs/plans/_active-execution/director-angel-remaining-execution.md",
    needles: [
      "[x] I.3 非语音 provider smoke 候选",
      "优先 media-understanding 或视觉/视频 provider 候选",
      "不触碰 TTS/STT",
      "没有显式 operator-approved provider mode 时，不使用凭据和网络",
    ],
  },
];

const requiredArtifactCoverage = [
  {
    id: "agent-os-all-latest-non-voice-provider-smoke-candidate-report",
    path: "benchmarks/results/director-agent-os-all-gate-latest.json",
    checks: [
      (report) => report?.suiteId === "director-agent-os-all-gate",
      (report) =>
        report?.nonVoiceProviderSmokeCandidate?.schemaVersion ===
        "director.agent-os.non-voice-provider-smoke-candidate.v1",
      (report) => report?.nonVoiceProviderSmokeCandidate?.status === "ready",
      (report) =>
        report?.nonVoiceProviderSmokeCandidate?.providerCandidate?.extensionId ===
        "media-understanding.local",
      (report) =>
        report?.nonVoiceProviderSmokeCandidate?.providerCandidate?.providerId ===
        "media-understanding",
      (report) =>
        report?.nonVoiceProviderSmokeCandidate?.providerCandidate?.candidateMode ===
        "local-metadata-dry-run",
      (report) =>
        report?.nonVoiceProviderSmokeCandidate?.providerCandidate?.sandboxPolicy?.defaultMode ===
        "readonly",
      (report) =>
        report?.nonVoiceProviderSmokeCandidate?.providerCandidate?.sandboxPolicy?.networkPolicy ===
        "none",
      (report) =>
        report?.nonVoiceProviderSmokeCandidate?.providerCandidate?.providerCredentialsUsed ===
        false,
      (report) => report?.nonVoiceProviderSmokeCandidate?.providerCandidate?.networkUsed === false,
      (report) =>
        report?.nonVoiceProviderSmokeCandidate?.providerCandidate?.liveRunnerStarted === false,
      (report) =>
        report?.nonVoiceProviderSmokeCandidate?.providerCandidate?.operatorApprovedProviderMode ===
        false,
      (report) =>
        report?.nonVoiceProviderSmokeCandidate?.runnerIntentState?.runnerIntentTokenIssued ===
        false,
      (report) =>
        report?.nonVoiceProviderSmokeCandidate?.runnerIntentState?.runnerIntentSigned === false,
      (report) =>
        report?.nonVoiceProviderSmokeCandidate?.runnerIntentState?.runnerIntentUnlocked === false,
      (report) =>
        report?.nonVoiceProviderSmokeCandidate?.runnerIntentState?.runnerIntentRevocationStatus ===
        "revoked",
      (report) =>
        report?.nonVoiceProviderSmokeCandidate?.sandboxBackendAdmissionEvidence?.status ===
        "admitted-dry-run",
      (report) =>
        report?.nonVoiceProviderSmokeCandidate?.sandboxBackendAdmissionEvidence?.backend ===
        "readonly",
      (report) =>
        report?.nonVoiceProviderSmokeCandidate?.sandboxBackendAdmissionEvidence?.networkPolicy ===
        "none",
      (report) =>
        report?.nonVoiceProviderSmokeCandidate?.summary?.providerCredentialsUsedCount === 0,
      (report) => report?.nonVoiceProviderSmokeCandidate?.summary?.networkUsedCount === 0,
      (report) => report?.nonVoiceProviderSmokeCandidate?.summary?.liveRunnerStartedCount === 0,
    ],
  },
  {
    id: "non-voice-provider-smoke-candidate-artifact-file",
    path: artifactRelativePath,
    checks: [
      (artifact) =>
        artifact?.schemaVersion === "director.agent-os.non-voice-provider-smoke-candidate.v1",
      (artifact) => artifact?.status === "ready",
      (artifact) => artifact?.providerCandidate?.extensionId === "media-understanding.local",
      (artifact) => artifact?.providerCandidate?.candidateMode === "local-metadata-dry-run",
      (artifact) => artifact?.providerCandidate?.sandboxPolicy?.networkPolicy === "none",
      (artifact) => artifact?.providerCandidate?.providerCredentialsUsed === false,
      (artifact) => artifact?.providerCandidate?.networkUsed === false,
      (artifact) => artifact?.providerCandidate?.liveRunnerStarted === false,
      (artifact) => artifact?.runnerIntentState?.runnerIntentRevocationStatus === "revoked",
      (artifact) => artifact?.sandboxBackendAdmissionEvidence?.status === "admitted-dry-run",
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

function resolveDesktopRunnerIntentState(report) {
  const packet = (report?.releaseSmokeRunnerIntentSigningRevocation?.packets ?? []).find(
    (candidate) => candidate.id === "live-external-provider-account-smoke",
  );
  return {
    runnerIntentContractMode:
      packet?.runnerIntentContractMode ?? "fail-closed-runner-intent-signing-revocation",
    runnerIntentSigningStatus: packet?.runnerIntentSigningStatus ?? "blocked",
    runnerIntentRevocationStatus: packet?.runnerIntentRevocationStatus ?? "revoked",
    runnerIntentSigned: packet?.runnerIntentSigned === true,
    runnerIntentSignatureReady: packet?.runnerIntentSignatureReady === true,
    runnerIntentTokenIssued: packet?.runnerIntentTokenIssued === true,
    runnerIntentUnlocked: packet?.runnerIntentUnlocked === true,
  };
}

function createNonVoiceProviderSmokeCandidate(allGateReport) {
  const runnerIntentState = resolveDesktopRunnerIntentState(allGateReport);
  return {
    schemaVersion: "director.agent-os.non-voice-provider-smoke-candidate.v1",
    status: "ready",
    candidateId: "media-understanding.local.non-voice-provider-smoke",
    providerCandidate: {
      extensionId: "media-understanding.local",
      providerId: "media-understanding",
      candidateMode: "local-metadata-dry-run",
      runnerKind: "local-metadata",
      capabilities: [
        "media.understand_image",
        "media.understand_video",
        "artifact.metadata.inspect",
      ],
      excludedCapabilities: ["media.understand_audio.semantic-transcription"],
      sandboxPolicy: {
        defaultMode: "readonly",
        networkPolicy: "none",
        requiresCommandPattern: false,
      },
      supportedContainers: ["mp4", "webm", "flac"],
      semanticTranscription: "unsupported",
      providerCredentialsUsed: false,
      networkUsed: false,
      liveRunnerStarted: false,
      operatorApprovedProviderMode: false,
    },
    sandboxBackendAdmissionEvidence: {
      schemaVersion: "director.agent-os.provider-smoke.sandbox-backend-admission-evidence.v1",
      status: "admitted-dry-run",
      backend: "readonly",
      networkPolicy: "none",
      filesystem: {
        readableRoots: ["benchmarks/fixtures/media"],
        writableRoots: [],
      },
      processLedgerRequired: false,
      dryRunOnly: true,
    },
    runnerIntentState,
    summary: {
      candidateCount: 1,
      sandboxBackendAdmissionEvidenceCount: 1,
      providerCredentialsUsedCount: 0,
      networkUsedCount: 0,
      liveRunnerStartedCount: 0,
      runnerIntentTokenIssuedCount: runnerIntentState.runnerIntentTokenIssued ? 1 : 0,
      runnerIntentSignedCount: runnerIntentState.runnerIntentSigned ? 1 : 0,
      runnerIntentUnlockedCount: runnerIntentState.runnerIntentUnlocked ? 1 : 0,
      runnerIntentRevokedCount:
        runnerIntentState.runnerIntentRevocationStatus === "revoked" ? 1 : 0,
    },
  };
}

function resolveAllGateReportWithNonVoiceProviderSmokeCandidate(report) {
  if (report?.nonVoiceProviderSmokeCandidate) {
    return report;
  }
  const artifact = readJsonOrNull(artifactRelativePath);
  return {
    ...(report ?? { suiteId: "director-agent-os-all-gate" }),
    nonVoiceProviderSmokeCandidate: artifact,
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
    const artifactPath = resolve(repoRoot, item.path);
    const artifactExists = existsSync(artifactPath);
    const artifact = artifactExists ? readJsonOrNull(item.path) : null;
    const subject =
      item.id === "agent-os-all-latest-non-voice-provider-smoke-candidate-report"
        ? resolveAllGateReportWithNonVoiceProviderSmokeCandidate(artifact)
        : artifact;
    const failedChecks = item.checks
      .map((check, index) => ({ index, passed: check(subject) }))
      .filter((check) => !check.passed)
      .map((check) => `check-${check.index}`);
    return {
      id: item.id,
      path: item.path,
      status: artifactExists && failedChecks.length === 0 ? "passed" : "failed",
      artifactExists,
      failedChecks,
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

const allGateReport = readJsonOrNull("benchmarks/results/director-agent-os-all-gate-latest.json");
const candidateArtifact = createNonVoiceProviderSmokeCandidate(allGateReport);
writeFileSync(
  resolve(repoRoot, artifactRelativePath),
  `${JSON.stringify(candidateArtifact, null, 2)}\n`,
  "utf8",
);

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
  `Director Agent OS non-voice provider smoke candidate gate completed: ${report.status}\n`,
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
    "Director Agent OS non-voice provider smoke candidate gate failed.",
    [sourceDetails, artifactDetails].filter(Boolean).join("\n"),
  );
}
