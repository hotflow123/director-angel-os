import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-voicenext-agent-os-voice-regression-safety-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredCoverage = [
  {
    id: "director-runtime-stt-provider-fail-closed-source",
    path: "packages/director-runtime/src/api-provider-adapters.ts",
    needles: [
      "createVoiceBatchSpeechToTextProviderPlugins",
      "createFailClosedSpeechToTextSideEffects",
      "microphoneAccessed: false",
      "rawAudioPersisted: false",
      "providerCredentialsUsed: false",
      "networkUsed: false",
      "localProcessStarted: false",
      "whisperStarted: false",
      "音频为空，未启动语音转文字。",
      "没有听清有效内容，未生成空 transcript。",
      "memoryWrite: false",
    ],
  },
  {
    id: "director-runtime-local-whisper-sandbox-source",
    path: "packages/director-runtime/src/api-provider-adapters.ts",
    needles: [
      "planLocalWhisperTranscription",
      "runLocalWhisperTranscription",
      "filterLikelyWhisperHallucinationTranscript",
      "本地 Whisper 需要 Agent OS 沙箱执行器；未执行裸 commandRunner。",
      "Whisper 模型 ${model} 不在允许列表。",
      "输入音频路径不在授权目录内",
      "output_format",
      "json",
      "shell: false",
      'networkPolicy: "none"',
      "summarizeCommandOutput",
    ],
  },
  {
    id: "director-runtime-tts-provider-fail-closed-source",
    path: "packages/director-runtime/src/api-provider-adapters.ts",
    needles: [
      "createVoiceSpeechProviderPlugins",
      "createFailClosedSpeechProviderSideEffects",
      "speakerAccessed: false",
      "autoplayed: false",
      "rawTextPersisted: false",
      "runSpeechSynthesis",
      "createSpeechSynthesisArtifact",
      "朗读文本为空，未启动语音合成。",
      "朗读文本太长",
      "autoplay: false",
      "memoryWrite: false",
    ],
  },
  {
    id: "live-runner-realtime-talk-fail-closed-source",
    path: "packages/live-runner-core/src/index.ts",
    needles: [
      "createGatewayRelayRealtimeTalkSessionPlan",
      "createRealtimeTranscriptEvent",
      "createRealtimeTalkStatusEvent",
      "stopRealtimeTalkSession",
      "realtime.transcript.partial",
      "realtime.transcript.final",
      "talk.status",
      "缺少操作授权，未启动实时语音对话。",
      "createFailClosedRealtimeTalkSideEffects",
      "providerCredentialsUsed: false",
      "networkUsed: false",
      "audioBytesRead: false",
      "microphoneAccessed: false",
      "speakerAccessed: false",
    ],
  },
  {
    id: "channels-core-voice-envelope-source",
    path: "packages/channels-core/src/channel-voice-input.ts",
    needles: [
      "ChannelVoiceInputEnvelope",
      "planChannelVoiceTranscription",
      "usesUnifiedConversationRuntime: true",
      "rawAudioLoaded: false",
      "providerSelectedByChannel: false",
      "audio.transcribe",
      "desktop-recording",
      "weixin-voice",
      "upload",
      "微信语音消息缺少 messageId",
      "audioBytesRead: false",
      "providerCredentialsUsed: false",
      "microphoneAccessed: false",
    ],
  },
  {
    id: "voice-regression-unit-tests",
    path: "packages/director-runtime/tests/api-provider-adapters.test.ts",
    needles: [
      "declares batch STT providers as fail-closed plugins with Chinese diagnostics",
      "runs local Whisper only through a sandbox runner and caps command output",
      "keeps local Whisper fail-closed without sandbox runner and filters silence hallucinations",
      "declares TTS providers as fail-closed plugins with Chinese diagnostics",
      "synthesizes speech into an audio artifact without autoplay or memory writes",
      "blocks TTS when provider is missing, text is empty, or text is too long",
    ],
  },
  {
    id: "voice-regression-live-runner-tests",
    path: "packages/live-runner-core/tests/live-runner-core.test.ts",
    needles: [
      "plans gateway-relay realtime Talk sessions fail-closed until operator evidence exists",
      "creates durable realtime transcript and Talk status events without side effects",
      "stops realtime Talk sessions without leaking provider secrets or audio side effects",
      "realtime.transcript.partial",
      "talk.status",
    ],
  },
  {
    id: "voice-regression-channel-tests",
    path: "packages/channels-core/tests/channel-voice-input.test.ts",
    needles: [
      "normalizes desktop, weixin, and upload voice into one audio.transcribe plan",
      "blocks unsupported or incomplete channel voice input without reading audio",
      "usesUnifiedConversationRuntime",
      "audioBytesRead: false",
      "providerCredentialsUsed: false",
    ],
  },
];

function readText(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function evaluateCoverage() {
  return requiredCoverage.map((item) => {
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

const coverage = evaluateCoverage();
const failed = coverage.filter((item) => item.status !== "passed");
const report = {
  suiteId,
  generatedAt: new Date().toISOString(),
  status: failed.length === 0 ? "passed" : "failed",
  summary: {
    coverageCount: coverage.length,
    passedCount: coverage.length - failed.length,
    failedCount: failed.length,
  },
  coverage,
  safetyContract: {
    microphoneAutostartAllowed: false,
    rawAudioReadAllowed: false,
    rawAudioPersistedByDefault: false,
    providerCredentialReadAllowed: false,
    nakedLocalProcessAllowed: false,
    realWhisperStartAllowed: false,
    ttsAutoplayAllowedByDefault: false,
    channelSpecificSttSideDoorAllowed: false,
  },
};

mkdirSync(resultsDir, { recursive: true });
writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`);

if (failed.length > 0) {
  console.error(
    `Director Agent OS voice regression safety gate failed: ${failed
      .map((item) => item.id)
      .join(", ")}`,
  );
  console.error(`Report: ${latestPath}`);
  process.exit(1);
}

console.log("Director Agent OS voice regression safety gate completed: passed");
console.log(`Coverage: ${report.summary.passedCount}/${report.summary.coverageCount}`);
console.log(`Report: ${latestPath}`);
