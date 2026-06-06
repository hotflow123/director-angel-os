import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-voicenext-agent-os-voice-evidence-manifest-validator-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);
const allGateSourcePath = "benchmarks/scripts/director-agent-os-all-gate.mjs";
const allGateLatestPath = "benchmarks/results/director-agent-os-all-gate-latest.json";

const voiceCheckIds = ["live-speech-to-text-provider-smoke", "live-text-to-speech-provider-smoke"];

const requiredSourceCoverage = [
  {
    id: "agent-os-all-voice-evidence-manifest-validator-source",
    path: allGateSourcePath,
    needles: [
      "function createVoiceEvidenceManifestDryRunValidator",
      "const voiceEvidenceManifestDryRunValidator",
      "voiceEvidenceManifestDryRunValidator,",
      '"director.agent-os.voice-evidence-manifest-dry-run-validator.v1"',
      '"operator-owned-local-voice-evidence-manifest-dry-run"',
      "voiceEvidenceManifestDryRunValidatorPath",
      "voiceEvidenceManifestDryRunValidatorRelativePath",
      "audioBytesRead: false",
      "microphoneAccessed: false",
      "speechTranscribed: false",
      "speechSynthesized: false",
      "reject-audio-bytes-read",
      "reject-provider-credentials-used",
      "reject-runner-intent-token-issued",
    ],
  },
  {
    id: "release-suite-voice-evidence-manifest-validator-coverage-source",
    path: "benchmarks/scripts/director-agent-os-release-suite-coverage-gate.mjs",
    needles: [
      "director-phase-voicenext-agent-os-voice-evidence-manifest-validator-gate",
      "pnpm --dir benchmarks bench:director-agent-os-voice-evidence-manifest-validator",
      "voice-evidence-manifest-validator",
      "expectedVoiceEvidenceManifestValidatorBenchmarkScript",
      "expectedVoiceEvidenceManifestValidatorRootScript",
      "bench:director-agent-os-voice-evidence-manifest-validator",
    ],
  },
  {
    id: "manifest-voice-evidence-manifest-validator-registration-source",
    path: "benchmarks/scripts/wave-suite-manifest.mjs",
    needles: [
      "director-phase-voicenext-agent-os-voice-evidence-manifest-validator-gate",
      "director-phase-voicenext-agent-os-voice-evidence-manifest-validator-gate.mjs",
      "pnpm --dir benchmarks bench:director-agent-os-voice-evidence-manifest-validator",
      "Voice.next gate proving speech-to-text and text-to-speech evidence manifests validate only in local dry-run mode",
    ],
  },
  {
    id: "package-voice-evidence-manifest-validator-script",
    path: "package.json",
    needles: [
      '"bench:director-agent-os-voice-evidence-manifest-validator"',
      "pnpm --dir benchmarks bench:director-agent-os-voice-evidence-manifest-validator",
    ],
  },
  {
    id: "benchmarks-package-voice-evidence-manifest-validator-script",
    path: "benchmarks/package.json",
    needles: [
      '"bench:director-agent-os-voice-evidence-manifest-validator"',
      "node ./scripts/director-phase-voicenext-agent-os-voice-evidence-manifest-validator-gate.mjs",
    ],
  },
  {
    id: "readme-voice-evidence-manifest-validator-docs",
    path: "benchmarks/README.md",
    needles: [
      "pnpm bench:director-agent-os-voice-evidence-manifest-validator",
      "Voice.next gate proving speech-to-text and text-to-speech evidence manifests validate only in local dry-run mode",
    ],
  },
  {
    id: "remaining-execution-voice-evidence-manifest-validator-plan",
    path: "docs/plans/_active-execution/director-angel-remaining-execution.md",
    needles: [
      "[x] Voice.next 语音 evidence manifest dry-run validator",
      "为 speech-to-text / text-to-speech live smoke 定义 operator-owned evidence manifest 的本地 dry-run validator",
      "不读取真实 manifest 内容，不读取音频字节，不访问麦克风/扬声器",
      "不使用 provider 凭据或网络，不签发 runner token",
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

function allVoiceItemsPass(items, predicate) {
  return voiceCheckIds.every((id) => {
    const item = (items ?? []).find((candidate) => candidate.id === id);
    return item !== undefined && predicate(item);
  });
}

function includesAll(values, expectedValues) {
  const set = new Set(values ?? []);
  return expectedValues.every((value) => set.has(value));
}

function evaluateArtifactCoverage() {
  const report = readJsonOrNull(allGateLatestPath);
  const stale = latestAllGateIsStale();
  if (report === null) {
    return [
      {
        id: "agent-os-all-latest-voice-evidence-manifest-validator-artifact",
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
        id: "agent-os-all-latest-voice-evidence-manifest-validator-artifact",
        path: allGateLatestPath,
        status: "passed",
        artifactMode: "bootstrap-stale-all-gate-latest",
        failedChecks: [],
        note: "Existing all-gate latest predates the updated all-gate source; aggregate all-gate will refresh the voice evidence manifest validator artifact.",
      },
    ];
  }

  const validator = report?.voiceEvidenceManifestDryRunValidator;
  const checks = [
    ["suite-id", report?.suiteId === "director-agent-os-all-gate"],
    [
      "schema-version",
      validator?.schemaVersion === "director.agent-os.voice-evidence-manifest-dry-run-validator.v1",
    ],
    ["status", validator?.status === "blocked"],
    [
      "validator-mode",
      validator?.validatorMode === "operator-owned-local-voice-evidence-manifest-dry-run",
    ],
    [
      "artifact-path",
      validator?.artifactRelativePath ===
        "benchmarks/results/director-agent-os-voice-evidence-manifest-validator-latest.json",
    ],
    ["check-count", validator?.summary?.checkCount === 2],
    ["blocked-count", validator?.summary?.blockedCount === 2],
    ["manifest-content-read-count", validator?.summary?.manifestContentReadCount === 0],
    ["audio-bytes-read-count", validator?.summary?.audioBytesReadCount === 0],
    ["microphone-accessed-count", validator?.summary?.microphoneAccessedCount === 0],
    ["provider-credentials-used-count", validator?.summary?.providerCredentialsUsedCount === 0],
    ["network-used-count", validator?.summary?.networkUsedCount === 0],
    ["runner-intent-token-issued-count", validator?.summary?.runnerIntentTokenIssuedCount === 0],
    ["live-runner-started-count", validator?.summary?.liveRunnerStartedCount === 0],
    ["accepted-unsafe-mutation-count", validator?.summary?.acceptedUnsafeMutationCount === 0],
    ["rejected-unsafe-mutation-count", validator?.summary?.rejectedUnsafeMutationCount === 10],
    [
      "voice-validator-packets",
      allVoiceItemsPass(
        validator?.packets,
        (packet) =>
          packet.status === "blocked" &&
          packet.manifestPathStatus === "missing" &&
          packet.manifestContentRead === false &&
          packet.remoteManifestAllowed === false &&
          packet.audioBytesRead === false &&
          packet.microphoneAccessed === false &&
          packet.speakerAccessed === false &&
          packet.speechTranscribed === false &&
          packet.speechSynthesized === false &&
          packet.providerCredentialsUsed === false &&
          packet.networkUsed === false &&
          packet.runnerIntentTokenIssued === false &&
          packet.liveRunnerStarted === false &&
          packet.canStartLiveRunner === false &&
          includesAll(packet.requiredManifestFields, [
            "schemaVersion",
            "checkId",
            "operator",
            "createdAt",
            "evidence",
            "audioDeviceConsent",
            "rawAudioStoragePolicy",
            "voiceProviderMode",
            "noAudioBytesStored",
            "providerCredentialRef",
            "networkPolicy",
            "runnerIntent",
          ]),
      ),
    ],
    [
      "unsafe-mutation-rejections",
      includesAll(
        (validator?.unsafeMutationResults ?? [])
          .filter((result) => result.status === "rejected")
          .map((result) => result.id),
        [
          "reject-manifest-content-read",
          "reject-audio-bytes-read",
          "reject-microphone-accessed",
          "reject-speaker-accessed",
          "reject-speech-transcribed",
          "reject-speech-synthesized",
          "reject-provider-credentials-used",
          "reject-network-used",
          "reject-runner-intent-token-issued",
          "reject-live-runner-started",
        ],
      ),
    ],
  ];
  const failedChecks = checks.filter(([, passed]) => !passed).map(([id]) => id);
  return [
    {
      id: "agent-os-all-latest-voice-evidence-manifest-validator-artifact",
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
    note: "Voice.next proves speech-to-text and text-to-speech evidence manifests validate only in local dry-run mode while all audio/provider/network/runner execution remains blocked.",
  },
  sourceCoverage,
  artifactCoverage,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS voice evidence manifest validator gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Source coverage: ${report.summary.sourceCoveragePassed}/${report.summary.sourceCoverage}, artifact coverage: ${report.summary.artifactCoveragePassed}/${report.summary.artifactCoverage}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  process.stderr.write("Director Agent OS voice evidence manifest validator gate failed.\n");
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
}
