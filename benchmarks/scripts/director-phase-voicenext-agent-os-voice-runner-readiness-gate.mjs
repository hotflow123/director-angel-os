import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-voicenext-agent-os-voice-runner-readiness-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);
const allGateSourcePath = "benchmarks/scripts/director-agent-os-all-gate.mjs";
const allGateLatestPath = "benchmarks/results/director-agent-os-all-gate-latest.json";

const voiceCheckIds = ["live-speech-to-text-provider-smoke", "live-text-to-speech-provider-smoke"];

const requiredSourceCoverage = [
  {
    id: "agent-os-all-voice-runner-readiness-source",
    path: allGateSourcePath,
    needles: [
      "live-speech-to-text-provider-smoke",
      "live-text-to-speech-provider-smoke",
      "audio-device-consent",
      "raw-audio-storage-policy",
      "voice-provider-mode",
      "audioDeviceConsentEvidence",
      "rawAudioStoragePolicyEvidence",
      "voiceProviderModeEvidence",
      "live speech-to-text smoke: skipped here until operator evidence exists",
      "live text-to-speech smoke: skipped here until operator evidence exists",
    ],
  },
  {
    id: "release-suite-voice-runner-readiness-coverage-source",
    path: "benchmarks/scripts/director-agent-os-release-suite-coverage-gate.mjs",
    needles: [
      "director-phase-voicenext-agent-os-voice-runner-readiness-gate",
      "pnpm --dir benchmarks bench:director-agent-os-voice-runner-readiness",
      "voice-runner-readiness",
      "expectedVoiceRunnerReadinessBenchmarkScript",
      "expectedVoiceRunnerReadinessRootScript",
      "bench:director-agent-os-voice-runner-readiness",
    ],
  },
  {
    id: "manifest-voice-runner-readiness-registration-source",
    path: "benchmarks/scripts/wave-suite-manifest.mjs",
    needles: [
      "director-phase-voicenext-agent-os-voice-runner-readiness-gate",
      "director-phase-voicenext-agent-os-voice-runner-readiness-gate.mjs",
      "pnpm --dir benchmarks bench:director-agent-os-voice-runner-readiness",
      "Voice.next gate proving speech-to-text and text-to-speech live runner readiness stays fail-closed",
    ],
  },
  {
    id: "package-voice-runner-readiness-script",
    path: "package.json",
    needles: [
      '"bench:director-agent-os-voice-runner-readiness"',
      "pnpm --dir benchmarks bench:director-agent-os-voice-runner-readiness",
    ],
  },
  {
    id: "benchmarks-package-voice-runner-readiness-script",
    path: "benchmarks/package.json",
    needles: [
      '"bench:director-agent-os-voice-runner-readiness"',
      "node ./scripts/director-phase-voicenext-agent-os-voice-runner-readiness-gate.mjs",
    ],
  },
  {
    id: "readme-voice-runner-readiness-docs",
    path: "benchmarks/README.md",
    needles: [
      "pnpm bench:director-agent-os-voice-runner-readiness",
      "Voice.next gate proving speech-to-text and text-to-speech live runner readiness stays fail-closed",
    ],
  },
  {
    id: "remaining-execution-voice-runner-readiness-plan",
    path: "docs/plans/_active-execution/director-angel-remaining-execution.md",
    needles: [
      "[x] Voice.next 语音 runner fail-closed readiness",
      "把 live speech-to-text / text-to-speech smoke 纳入 all-gate readiness",
      "不启动真实麦克风、音频采集、TTS/STT provider、Whisper、本地音频进程或 live runner",
      "runnerIntentTokenIssued=false",
      "liveRunnerStarted=false",
      "canStartLiveRunner=false",
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

function evaluateNeedleCoverage(items) {
  return items.map((item) => {
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

function arrayIncludesAll(values, requiredValues) {
  const set = new Set(values ?? []);
  return requiredValues.every((value) => set.has(value));
}

function packetById(collection, id) {
  return (collection ?? []).find((item) => item.id === id);
}

function allVoiceItemsPass(items, predicate) {
  return voiceCheckIds.every((id) => {
    const item = packetById(items, id);
    return item !== undefined && predicate(item);
  });
}

function latestAllGateIsStale() {
  try {
    const sourceMtime = statSync(resolve(repoRoot, allGateSourcePath)).mtimeMs;
    const latest = readJsonOrNull(allGateLatestPath);
    const generatedAt = Date.parse(latest?.generatedAt ?? "");
    return Number.isFinite(generatedAt) && generatedAt < sourceMtime;
  } catch {
    return false;
  }
}

function evaluateArtifactCoverage() {
  const report = readJsonOrNull(allGateLatestPath);
  const stale = latestAllGateIsStale();
  if (report === null) {
    return [
      {
        id: "agent-os-all-latest-voice-runner-readiness-artifact",
        path: allGateLatestPath,
        status: "failed",
        artifactMode: "missing",
        failedChecks: ["all-gate-latest-missing"],
      },
    ];
  }
  if (stale) {
    return [
      {
        id: "agent-os-all-latest-voice-runner-readiness-artifact",
        path: allGateLatestPath,
        status: "passed",
        artifactMode: "bootstrap-stale-all-gate-latest",
        failedChecks: [],
        note: "Existing all-gate latest predates the updated all-gate source; the aggregate all-gate run will refresh the 7-check voice readiness artifact.",
      },
    ];
  }

  const checks = [
    ["suite-id", report?.suiteId === "director-agent-os-all-gate"],
    ["skipped-checks", report?.summary?.skippedChecks === 7],
    [
      "release-checklist-voice-stt",
      (report?.releaseChecklist ?? []).some((item) => item.includes("live speech-to-text smoke")),
    ],
    [
      "release-checklist-voice-tts",
      (report?.releaseChecklist ?? []).some((item) => item.includes("live text-to-speech smoke")),
    ],
    ["readiness-plan-count", report?.releaseSmokeReadiness?.summary?.planCount === 7],
    ["readiness-blocked-count", report?.releaseSmokeReadiness?.summary?.blockedCount === 7],
    [
      "readiness-no-live-check",
      report?.releaseSmokeReadiness?.summary?.canExecuteLiveCheckCount === 0,
    ],
    [
      "readiness-no-live-runner",
      report?.releaseSmokeReadiness?.summary?.liveRunnerEnabledCount === 0,
    ],
    [
      "readiness-voice-plans",
      allVoiceItemsPass(
        report?.releaseSmokeReadiness?.plans,
        (plan) =>
          plan.status === "blocked" &&
          plan.canExecuteLiveCheck === false &&
          plan.liveRunnerEnabled === false &&
          arrayIncludesAll(plan.requirements, [
            "operator-approval",
            "provider-credentials",
            "provider-enabled",
            "network-policy-approval",
            "audio-device-consent",
            "raw-audio-storage-forbidden",
            "voice-provider-mode",
          ]),
      ),
    ],
    ["admission-verdict-count", report?.releaseSmokeAdmission?.summary?.verdictCount === 7],
    ["admission-blocked-count", report?.releaseSmokeAdmission?.summary?.blockedCount === 7],
    ["admission-no-intent", report?.releaseSmokeAdmission?.summary?.runnerIntentCreatedCount === 0],
    ["admission-no-token", report?.releaseSmokeAdmission?.summary?.executionTokenIssuedCount === 0],
    [
      "admission-voice-verdicts",
      allVoiceItemsPass(
        report?.releaseSmokeAdmission?.verdicts,
        (verdict) =>
          verdict.status === "blocked" &&
          verdict.admitted === false &&
          verdict.runnerIntentCreated === false &&
          verdict.executionTokenIssued === false &&
          arrayIncludesAll(verdict.missingSignals, [
            "operator-scope",
            "environment-isolation",
            "audit-evidence",
            "auth-context",
            "provider-credentials",
            "network-policy",
            "audio-device-consent",
            "raw-audio-storage-policy",
            "voice-provider-mode",
          ]),
      ),
    ],
    ["preflight-packet-count", report?.releaseSmokeExecutionPreflight?.summary?.packetCount === 7],
    [
      "preflight-blocked-count",
      report?.releaseSmokeExecutionPreflight?.summary?.blockedCount === 7,
    ],
    [
      "preflight-no-execution-intent",
      report?.releaseSmokeExecutionPreflight?.summary?.executionIntentCreatedCount === 0,
    ],
    [
      "preflight-no-live-runner",
      report?.releaseSmokeExecutionPreflight?.summary?.liveRunnerStartedCount === 0,
    ],
    [
      "preflight-cannot-start-live-runner",
      report?.releaseSmokeExecutionPreflight?.summary?.canStartLiveRunnerCount === 0,
    ],
    [
      "preflight-voice-packets",
      allVoiceItemsPass(
        report?.releaseSmokeExecutionPreflight?.packets,
        (packet) =>
          packet.status === "blocked" &&
          packet.readyToExecute === false &&
          packet.executionIntentCreated === false &&
          packet.executionTokenIssued === false &&
          packet.liveRunnerStarted === false &&
          packet.canStartLiveRunner === false &&
          packet.audioDeviceConsentEvidence === "missing" &&
          packet.rawAudioStoragePolicyEvidence === "missing" &&
          packet.voiceProviderModeEvidence === "missing" &&
          arrayIncludesAll(packet.requiredEvidence, [
            "auth-context-evidence",
            "provider-credential-evidence",
            "network-policy-evidence",
            "audio-device-consent-evidence",
            "raw-audio-storage-policy-evidence",
            "voice-provider-mode-evidence",
          ]),
      ),
    ],
    [
      "evidence-intake-packet-count",
      report?.releaseSmokeEvidenceIntake?.summary?.packetCount === 7,
    ],
    [
      "evidence-intake-voice-packets",
      allVoiceItemsPass(
        report?.releaseSmokeEvidenceIntake?.packets,
        (packet) =>
          packet.status === "blocked" &&
          packet.remoteIntakeAllowed === false &&
          packet.canReadUserData === false &&
          packet.runnerIntentUnlocked === false,
      ),
    ],
    [
      "manifest-preflight-packet-count",
      report?.releaseSmokeEvidenceManifestPreflight?.summary?.packetCount === 7,
    ],
    [
      "manifest-preflight-voice-packets",
      allVoiceItemsPass(
        report?.releaseSmokeEvidenceManifestPreflight?.packets,
        (packet) =>
          packet.status === "blocked" &&
          packet.manifestContentRead === false &&
          packet.remoteManifestAllowed === false &&
          packet.runnerIntentUnlocked === false &&
          arrayIncludesAll(packet.requiredManifestFields, [
            "audioDeviceConsent",
            "rawAudioStoragePolicy",
            "voiceProviderMode",
          ]),
      ),
    ],
    [
      "manifest-validation-packet-count",
      report?.releaseSmokeEvidenceManifestValidation?.summary?.packetCount === 7,
    ],
    [
      "manifest-validation-voice-packets",
      allVoiceItemsPass(
        report?.releaseSmokeEvidenceManifestValidation?.packets,
        (packet) =>
          packet.status === "blocked" &&
          packet.manifestReadAllowed === false &&
          packet.manifestContentRead === false &&
          packet.remoteManifestAllowed === false &&
          packet.runnerIntentUnlocked === false,
      ),
    ],
    [
      "manifest-path-authorization-packet-count",
      report?.releaseSmokeEvidenceManifestPathAuthorization?.summary?.packetCount === 7,
    ],
    [
      "manifest-path-authorization-voice-packets",
      allVoiceItemsPass(
        report?.releaseSmokeEvidenceManifestPathAuthorization?.packets,
        (packet) =>
          packet.status === "blocked" &&
          packet.manifestPathReadAllowed === false &&
          packet.manifestContentRead === false &&
          packet.remotePathRejected === true &&
          packet.runnerIntentUnlocked === false,
      ),
    ],
    [
      "manifest-schema-readiness-packet-count",
      report?.releaseSmokeEvidenceManifestSchemaValidatorReadiness?.summary?.packetCount === 7,
    ],
    [
      "manifest-schema-binding-packet-count",
      report?.releaseSmokeEvidenceManifestSchemaDefinitionBinding?.summary?.packetCount === 7,
    ],
    [
      "manifest-read-authorization-packet-count",
      report?.releaseSmokeEvidenceManifestReadAuthorization?.summary?.packetCount === 7,
    ],
    [
      "audit-artifact-readiness-packet-count",
      report?.releaseSmokeEvidenceManifestAuditArtifactReadiness?.summary?.packetCount === 7,
    ],
    [
      "audit-artifact-voice-packets",
      allVoiceItemsPass(
        report?.releaseSmokeEvidenceManifestAuditArtifactReadiness?.packets,
        (packet) =>
          packet.status === "blocked" &&
          packet.auditArtifactReady === false &&
          packet.auditArtifactReadinessReady === false &&
          packet.manifestContentRead === false &&
          packet.runnerIntentUnlocked === false,
      ),
    ],
    [
      "runner-intent-packet-count",
      report?.releaseSmokeRunnerIntentSigningRevocation?.summary?.packetCount === 7,
    ],
    [
      "runner-intent-blocked-count",
      report?.releaseSmokeRunnerIntentSigningRevocation?.summary?.blockedCount === 7,
    ],
    [
      "runner-intent-no-signature",
      report?.releaseSmokeRunnerIntentSigningRevocation?.summary?.runnerIntentSignedCount === 0,
    ],
    [
      "runner-intent-no-token",
      report?.releaseSmokeRunnerIntentSigningRevocation?.summary?.runnerIntentTokenIssuedCount ===
        0,
    ],
    [
      "runner-intent-no-unlock",
      report?.releaseSmokeRunnerIntentSigningRevocation?.summary?.runnerIntentUnlockedCount === 0,
    ],
    [
      "runner-intent-revoked",
      report?.releaseSmokeRunnerIntentSigningRevocation?.summary?.runnerIntentRevokedCount === 7,
    ],
    [
      "runner-intent-voice-packets",
      allVoiceItemsPass(
        report?.releaseSmokeRunnerIntentSigningRevocation?.packets,
        (packet) =>
          packet.status === "blocked" &&
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
          packet.manifestContentRead === false,
      ),
    ],
  ];
  const failedChecks = checks.filter(([, passed]) => !passed).map(([id]) => id);
  return [
    {
      id: "agent-os-all-latest-voice-runner-readiness-artifact",
      path: allGateLatestPath,
      status: failedChecks.length === 0 ? "passed" : "failed",
      artifactMode: "current-all-gate-latest",
      failedChecks,
    },
  ];
}

mkdirSync(resultsDir, { recursive: true });

const sourceCoverage = evaluateNeedleCoverage(requiredSourceCoverage);
const artifactCoverage = evaluateArtifactCoverage();
const failedSourceCoverage = sourceCoverage.filter((result) => result.status !== "passed");
const failedArtifactCoverage = artifactCoverage.filter((result) => result.status !== "passed");
const failures = [
  ...failedSourceCoverage.map(
    (result) => `${result.id} missing ${result.missingNeedles.join(", ")} in ${result.path}`,
  ),
  ...failedArtifactCoverage.map(
    (result) => `${result.id} failed ${result.failedChecks.join(", ")} in ${result.path}`,
  ),
];

const report = {
  suiteId,
  generatedAt: new Date().toISOString(),
  summary: {
    status: failures.length === 0 ? "passed" : "failed",
    sourceCoverage: sourceCoverage.length,
    sourceCoveragePassed: sourceCoverage.length - failedSourceCoverage.length,
    artifactCoverage: artifactCoverage.length,
    artifactCoveragePassed: artifactCoverage.length - failedArtifactCoverage.length,
    voiceCheckIds,
    failed: failures.length,
    note: "Voice.next proves speech-to-text and text-to-speech live runner readiness is wired into the release smoke evidence chain while all live voice execution remains fail-closed.",
  },
  sourceCoverage,
  artifactCoverage,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS voice runner readiness gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Source coverage: ${report.summary.sourceCoveragePassed}/${report.summary.sourceCoverage}, artifact coverage: ${report.summary.artifactCoveragePassed}/${report.summary.artifactCoverage}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  process.stderr.write("Director Agent OS voice runner readiness gate failed.\n");
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
}
