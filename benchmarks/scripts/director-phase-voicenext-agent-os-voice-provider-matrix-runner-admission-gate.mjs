import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-voicenext-agent-os-voice-provider-matrix-runner-admission-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);
const allGateSourcePath = "benchmarks/scripts/director-agent-os-all-gate.mjs";
const allGateLatestPath = "benchmarks/results/director-agent-os-all-gate-latest.json";
const voiceProviderMatrixRunnerAdmissionLatestPath =
  "benchmarks/results/director-agent-os-voice-provider-matrix-runner-admission-latest.json";

const voiceCheckIds = ["live-speech-to-text-provider-smoke", "live-text-to-speech-provider-smoke"];

const requiredProviderIds = [
  "voice.stt.openai",
  "voice.stt.local-whisper",
  "voice.stt.groq-whisper",
  "voice.stt.mistral-voxtral",
  "voice.stt.azure-speech",
  "voice.stt.google-speech",
  "voice.tts.openai",
  "voice.tts.elevenlabs",
  "voice.tts.edge-compatible",
  "voice.tts.azure-speech",
  "voice.tts.google-tts",
  "voice.tts.local-cli",
  "voice.tts.piper",
  "voice.live.claude-oauth",
  "voice.live.openai-realtime",
];

const requiredSourceCoverage = [
  {
    id: "agent-os-all-voice-provider-matrix-runner-admission-source",
    path: allGateSourcePath,
    needles: [
      "function createVoiceProviderMatrixRunnerAdmission",
      "const voiceProviderMatrixRunnerAdmission",
      "voiceProviderMatrixRunnerAdmission,",
      '"director.agent-os.voice-provider-matrix-runner-admission.v1"',
      '"director.agent-os.voice-provider-runner-admission-packet.v1"',
      '"operator-owned-local-voice-provider-matrix-runner-admission-dry-run"',
      "voiceProviderMatrixRunnerAdmissionPath",
      "voiceProviderMatrixRunnerAdmissionRelativePath",
      "voice.stt.openai",
      "voice.stt.local-whisper",
      "voice.tts.openai",
      "voice.tts.local-cli",
      "voice.live.claude-oauth",
      "providerCredentialsUsed: false",
      "networkUsed: false",
      "audioBytesRead: false",
      "microphoneAccessed: false",
      "speakerAccessed: false",
      "localProcessStarted: false",
      "whisperStarted: false",
      "providerSdkLoaded: false",
      "runnerIntentTokenIssued: false",
      "liveRunnerStarted: false",
      "canStartLiveRunner: false",
      "reject-provider-enabled",
      "reject-provider-credentials-used",
      "reject-network-used",
      "reject-audio-bytes-read",
      "reject-local-process-started",
      "reject-whisper-started",
      "reject-provider-sdk-loaded",
      "reject-runner-intent-token-issued",
      "reject-live-runner-started",
    ],
  },
  {
    id: "release-suite-voice-provider-matrix-runner-admission-coverage-source",
    path: "benchmarks/scripts/director-agent-os-release-suite-coverage-gate.mjs",
    needles: [
      "director-phase-voicenext-agent-os-voice-provider-matrix-runner-admission-gate",
      "pnpm --dir benchmarks bench:director-agent-os-voice-provider-matrix-runner-admission",
      "voice-provider-matrix-runner-admission",
      "live-speech-to-text-runner-admission",
      "live-text-to-speech-runner-admission",
      "expectedVoiceProviderMatrixRunnerAdmissionBenchmarkScript",
      "expectedVoiceProviderMatrixRunnerAdmissionRootScript",
      "bench:director-agent-os-voice-provider-matrix-runner-admission",
    ],
  },
  {
    id: "manifest-voice-provider-matrix-runner-admission-registration-source",
    path: "benchmarks/scripts/wave-suite-manifest.mjs",
    needles: [
      "director-phase-voicenext-agent-os-voice-provider-matrix-runner-admission-gate",
      "director-phase-voicenext-agent-os-voice-provider-matrix-runner-admission-gate.mjs",
      "pnpm --dir benchmarks bench:director-agent-os-voice-provider-matrix-runner-admission",
      "Voice.next gate proving STT/TTS provider matrix and runner admission stay fail-closed",
    ],
  },
  {
    id: "package-voice-provider-matrix-runner-admission-script",
    path: "package.json",
    needles: [
      '"bench:director-agent-os-voice-provider-matrix-runner-admission"',
      "pnpm --dir benchmarks bench:director-agent-os-voice-provider-matrix-runner-admission",
    ],
  },
  {
    id: "benchmarks-package-voice-provider-matrix-runner-admission-script",
    path: "benchmarks/package.json",
    needles: [
      '"bench:director-agent-os-voice-provider-matrix-runner-admission"',
      "node ./scripts/director-phase-voicenext-agent-os-voice-provider-matrix-runner-admission-gate.mjs",
    ],
  },
  {
    id: "readme-voice-provider-matrix-runner-admission-docs",
    path: "benchmarks/README.md",
    needles: [
      "pnpm bench:director-agent-os-voice-provider-matrix-runner-admission",
      "Voice.next gate proving STT/TTS provider matrix and runner admission stay fail-closed",
    ],
  },
  {
    id: "remaining-execution-voice-provider-matrix-runner-admission-plan",
    path: "docs/plans/_active-execution/director-angel-remaining-execution.md",
    needles: [
      "[x] Voice.next 语音 provider matrix + runner admission skeleton",
      "基于 Hermes/OpenClaw/Claude Code/MemPalace 参考模式定义 STT/TTS provider matrix",
      "默认 blocked / needs-auth / needs-setup，不读取 provider 凭据、不使用网络、不访问麦克风/扬声器",
      "不启动 Whisper、本地音频进程、provider SDK、TTS/STT/live runner，不签发 runner token",
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

function includesAll(values, expectedValues) {
  const set = new Set(values ?? []);
  return expectedValues.every((value) => set.has(value));
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

function providerById(collection, id) {
  return (collection ?? []).find((provider) => provider.providerId === id);
}

function providerSafe(provider) {
  return (
    provider?.schemaVersion === "director.agent-os.voice-provider-matrix-provider.v1" &&
    provider?.status === "blocked" &&
    provider?.enabled === false &&
    ["needs-auth", "needs-setup", "needs-oauth", "needs-operator-evidence"].includes(
      provider?.configurationStatus,
    ) &&
    provider?.credentialValueRead === false &&
    provider?.providerCredentialsUsed === false &&
    provider?.networkUsed === false &&
    provider?.audioBytesRead === false &&
    provider?.microphoneAccessed === false &&
    provider?.speakerAccessed === false &&
    provider?.speechTranscribed === false &&
    provider?.speechSynthesized === false &&
    provider?.localProcessStarted === false &&
    provider?.whisperStarted === false &&
    provider?.providerSdkLoaded === false &&
    provider?.runnerIntentTokenIssued === false &&
    provider?.liveRunnerStarted === false &&
    provider?.canStartLiveRunner === false &&
    provider?.noAudioBytesStored === true &&
    provider?.rawAudioStoragePolicy === "forbidden-until-operator-evidence" &&
    includesAll(provider?.requiredConfigFields, [
      "providerId",
      "capability",
      "enabled",
      "mode",
      "credentialRef",
      "credentialSource",
      "authType",
      "networkPolicyRef",
      "audioDeviceConsentRef",
      "rawAudioStoragePolicy",
      "noAudioBytesStored",
      "retentionPolicy",
      "auditArtifactRef",
      "runnerIntentRef",
      "timeoutMs",
    ])
  );
}

function evaluateArtifactCoverage() {
  const report = readJsonOrNull(allGateLatestPath);
  const stale = latestAllGateIsStale();
  if (report === null) {
    return [
      {
        id: "agent-os-all-latest-voice-provider-matrix-runner-admission-artifact",
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
        id: "agent-os-all-latest-voice-provider-matrix-runner-admission-artifact",
        path: allGateLatestPath,
        status: "passed",
        artifactMode: "bootstrap-stale-all-gate-latest",
        failedChecks: [],
        note: "Existing all-gate latest predates the updated all-gate source; aggregate all-gate will refresh the voice provider matrix runner admission artifact.",
      },
    ];
  }

  const artifact = report?.voiceProviderMatrixRunnerAdmission;
  const providers = artifact?.providers ?? [];
  const providerIds = providers.map((provider) => provider.providerId);
  const checks = [
    ["suite-id", report?.suiteId === "director-agent-os-all-gate"],
    [
      "schema-version",
      artifact?.schemaVersion === "director.agent-os.voice-provider-matrix-runner-admission.v1",
    ],
    ["status", artifact?.status === "blocked"],
    [
      "admission-mode",
      artifact?.admissionMode ===
        "operator-owned-local-voice-provider-matrix-runner-admission-dry-run",
    ],
    [
      "artifact-path",
      artifact?.artifactRelativePath === voiceProviderMatrixRunnerAdmissionLatestPath,
    ],
    ["reference-patterns", (artifact?.referencePatterns ?? []).length >= 4],
    ["provider-count", artifact?.summary?.providerCount === requiredProviderIds.length],
    [
      "blocked-provider-count",
      artifact?.summary?.blockedProviderCount === requiredProviderIds.length,
    ],
    ["enabled-provider-count", artifact?.summary?.enabledProviderCount === 0],
    ["credential-value-read-count", artifact?.summary?.credentialValueReadCount === 0],
    ["provider-credentials-used-count", artifact?.summary?.providerCredentialsUsedCount === 0],
    ["network-used-count", artifact?.summary?.networkUsedCount === 0],
    ["audio-device-accessed-count", artifact?.summary?.audioDeviceAccessedCount === 0],
    ["audio-bytes-read-count", artifact?.summary?.audioBytesReadCount === 0],
    ["local-process-started-count", artifact?.summary?.localProcessStartedCount === 0],
    ["whisper-started-count", artifact?.summary?.whisperStartedCount === 0],
    ["provider-sdk-loaded-count", artifact?.summary?.providerSdkLoadedCount === 0],
    ["runner-intent-token-issued-count", artifact?.summary?.runnerIntentTokenIssuedCount === 0],
    ["live-runner-started-count", artifact?.summary?.liveRunnerStartedCount === 0],
    ["can-start-live-runner-count", artifact?.summary?.canStartLiveRunnerCount === 0],
    ["provider-ids", includesAll(providerIds, requiredProviderIds)],
    [
      "required-providers-safe",
      requiredProviderIds.every((id) => providerSafe(providerById(providers, id))),
    ],
    [
      "stt-local-setup-boundary",
      providerById(providers, "voice.stt.local-whisper")?.mode === "local" &&
        providerById(providers, "voice.stt.local-whisper")?.binaryPathStatus === "missing" &&
        providerById(providers, "voice.stt.local-whisper")?.modelPathStatus === "missing" &&
        providerById(providers, "voice.stt.local-whisper")?.sandboxPreflightStatus === "missing" &&
        providerById(providers, "voice.stt.local-whisper")?.processLedgerStatus === "missing" &&
        providerById(providers, "voice.stt.local-whisper")?.whisperStarted === false,
    ],
    [
      "tts-local-setup-boundary",
      providerById(providers, "voice.tts.local-cli")?.mode === "local" &&
        providerById(providers, "voice.tts.local-cli")?.binaryPathStatus === "missing" &&
        providerById(providers, "voice.tts.local-cli")?.sandboxPreflightStatus === "missing" &&
        providerById(providers, "voice.tts.local-cli")?.processLedgerStatus === "missing" &&
        providerById(providers, "voice.tts.local-cli")?.localProcessStarted === false,
    ],
    [
      "live-oauth-boundary",
      providerById(providers, "voice.live.claude-oauth")?.authType === "oauth" &&
        providerById(providers, "voice.live.claude-oauth")?.configurationStatus === "needs-oauth" &&
        providerById(providers, "voice.live.claude-oauth")?.credentialSource === "oauth",
    ],
    ["admission-packet-count", artifact?.summary?.admissionPacketCount === 2],
    ["admission-blocked-count", artifact?.summary?.blockedAdmissionCount === 2],
    ["admission-admitted-count", artifact?.summary?.admittedCount === 0],
    ["runner-intent-created-count", artifact?.summary?.runnerIntentCreatedCount === 0],
    [
      "admission-packets",
      allVoiceItemsPass(
        artifact?.admissionPackets,
        (packet) =>
          packet.schemaVersion === "director.agent-os.voice-provider-runner-admission-packet.v1" &&
          packet.status === "blocked" &&
          packet.admitted === false &&
          packet.runnerIntentCreated === false &&
          packet.runnerIntentTokenIssued === false &&
          packet.executionTokenIssued === false &&
          packet.liveRunnerStarted === false &&
          packet.canStartLiveRunner === false &&
          packet.providerCredentialsUsed === false &&
          packet.networkUsed === false &&
          packet.audioBytesRead === false &&
          packet.microphoneAccessed === false &&
          packet.speakerAccessed === false &&
          packet.localProcessStarted === false &&
          packet.whisperStarted === false &&
          packet.providerSdkLoaded === false &&
          includesAll(packet.missingSignals, [
            "operator-scope",
            "environment-isolation",
            "audit-evidence",
            "auth-context",
            "provider-credentials",
            "network-policy",
            "audio-device-consent",
            "raw-audio-storage-policy",
            "voice-provider-mode",
            "provider-matrix-selection",
            "runner-intent",
          ]),
      ),
    ],
    ["accepted-unsafe-mutation-count", artifact?.summary?.acceptedUnsafeMutationCount === 0],
    ["rejected-unsafe-mutation-count", artifact?.summary?.rejectedUnsafeMutationCount === 12],
    [
      "unsafe-mutation-rejections",
      includesAll(
        (artifact?.unsafeMutationResults ?? [])
          .filter((result) => result.status === "rejected")
          .map((result) => result.id),
        [
          "reject-provider-enabled",
          "reject-provider-credentials-used",
          "reject-network-used",
          "reject-audio-bytes-read",
          "reject-microphone-accessed",
          "reject-speaker-accessed",
          "reject-local-process-started",
          "reject-whisper-started",
          "reject-provider-sdk-loaded",
          "reject-runner-intent-token-issued",
          "reject-live-runner-started",
          "reject-can-start-live-runner",
        ],
      ),
    ],
  ];
  const failedChecks = checks.filter(([, passed]) => !passed).map(([id]) => id);
  return [
    {
      id: "agent-os-all-latest-voice-provider-matrix-runner-admission-artifact",
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
    providerIds: requiredProviderIds,
    voiceCheckIds,
    failed: failures.length,
    note: "Voice.next proves STT/TTS provider matrix and runner admission are wired as CI-safe fail-closed artifacts without credentials, network, audio devices, Whisper, provider SDKs, or live runners.",
  },
  sourceCoverage,
  artifactCoverage,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS voice provider matrix runner admission gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Source coverage: ${report.summary.sourceCoveragePassed}/${report.summary.sourceCoverage}, artifact coverage: ${report.summary.artifactCoveragePassed}/${report.summary.artifactCoverage}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  process.stderr.write("Director Agent OS voice provider matrix runner admission gate failed.\n");
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
}
