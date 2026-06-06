import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  LiveRunArtifact,
  LiveRunCapabilityId,
  LiveRunDriverCancelInput,
  LiveRunDriverCancelResult,
  LiveRunDriverPollInput,
  LiveRunDriverPollResult,
  LiveRunDriverStartInput,
  LiveRunDriverStartResult,
  LiveRunError,
  LiveRunProviderDriver,
  LiveRunProviderTask,
} from "@hotflow/live-runner-core";

import {
  type DirectorGenerationRequestPlan,
  buildDirectorMemefastGenerationRequestPlan,
  isDirectorMemefastAudioModel,
  summarizeDirectorGenerationRequestPlan,
} from "./memefast-generation-request-plan.js";

export const DIRECTOR_API_PROVIDER_CONFIG_SCHEMA_VERSION = "director.api-providers.v1" as const;
const DIRECTOR_TEXT_GENERATION_SUBMIT_TIMEOUT_MS = 60_000;
const DIRECTOR_MEDIA_GENERATION_SUBMIT_TIMEOUT_MS = 500_000;
const DIRECTOR_MEMEFAST_IMAGE_PROXY_UPLOAD_URL = "https://imageproxy.zhongzhuan.chat/api/upload";
const DIRECTOR_MEMEFAST_IMAGE_REFERENCE_KEYS = new Set([
  "image",
  "images",
  "image_url",
  "image_urls",
  "imageUrl",
  "imageUrls",
  "input_image",
  "inputImage",
  "promptImage",
  "prompt_image",
]);

export type DirectorApiProviderCapability =
  | "text"
  | "vision"
  | "function_calling"
  | "image_generation"
  | "video_generation"
  | "audio_generation"
  | "web_search"
  | "reasoning"
  | "embedding";

export type DirectorApiProviderEndpointId =
  | "chat.completions"
  | "image.generations"
  | "image.edits"
  | "video.create"
  | "video.generations"
  | "videos.official"
  | "audio.music"
  | "audio.lyrics"
  | "models.list";

export type DirectorApiProviderImageRouteFamily =
  | "openai_chat"
  | "openai_images"
  | "kling_image"
  | "unsupported";

export type DirectorApiProviderVideoRouteFamily =
  | "openai_official"
  | "happyhorse"
  | "pixverse"
  | "unified"
  | "volc"
  | "wan"
  | "kling"
  | "replicate"
  | "unknown";

export type DirectorApiProviderFeature =
  | "script_analysis"
  | "character_generation"
  | "scene_generation"
  | "video_generation"
  | "image_understanding"
  | "chat"
  | "freedom_image"
  | "freedom_video"
  | "freedom_music";

export type DirectorApiProviderFeatureBindings = Readonly<
  Record<DirectorApiProviderFeature, readonly string[]>
>;

export interface DirectorApiProviderEndpoint {
  readonly id: DirectorApiProviderEndpointId;
  readonly label: string;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly routeFamily: string;
  readonly bodyFields: readonly string[];
  readonly notes: readonly string[];
}

export interface DirectorApiProviderDefaults {
  readonly text: string;
  readonly vision: string;
  readonly image_generation: string;
  readonly video_generation: string;
  readonly audio_generation: string;
}

export interface DirectorApiProviderModelMetadata {
  readonly model: string;
  readonly brandId: string;
  readonly modelFamily: string;
  readonly modelType?: string;
  readonly tags: readonly string[];
  readonly enableGroups: readonly string[];
  readonly endpointTypes: readonly string[];
  readonly capabilities: readonly DirectorApiProviderCapability[];
  readonly imageRouteFamily: DirectorApiProviderImageRouteFamily;
  readonly videoRouteFamily: DirectorApiProviderVideoRouteFamily;
}

export interface DirectorApiProviderAdapter {
  readonly id: string;
  readonly platform: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly enabled: boolean;
  readonly apiKeyEnvVar: string;
  readonly apiKeyConfigured: boolean;
  readonly apiKeyMasked: string;
  readonly models: readonly string[];
  readonly capabilities: readonly DirectorApiProviderCapability[];
  readonly contextLimit?: number;
  readonly defaultModels: DirectorApiProviderDefaults;
  readonly advancedSettings: {
    readonly compatibilityMode: "memefast_compatible" | "standard_openai";
    readonly connectionTestFeature: "auto" | "chat" | "image_generation" | "video_generation";
  };
  readonly endpoints: readonly DirectorApiProviderEndpoint[];
  readonly modelMetadata: readonly DirectorApiProviderModelMetadata[];
  readonly featureBindings: DirectorApiProviderFeatureBindings;
  readonly notes: readonly string[];
}

export interface DirectorApiProviderConfigDocument {
  readonly schemaVersion: typeof DIRECTOR_API_PROVIDER_CONFIG_SCHEMA_VERSION;
  readonly updatedAt: string;
  readonly providers: readonly DirectorApiProviderAdapter[];
}

export interface LoadDirectorApiProviderConfigResult {
  readonly document: DirectorApiProviderConfigDocument;
  readonly configPath: string;
  readonly source: "defaults" | "file";
  readonly notes: readonly string[];
  readonly issues: readonly string[];
}

export type DirectorApiProviderSettingKey =
  | "enabled"
  | "apiKey"
  | "baseUrl"
  | "models"
  | "defaultTextModel"
  | "defaultVisionModel"
  | "defaultImageModel"
  | "defaultVideoModel"
  | "defaultAudioModel";

export interface DirectorApiProviderSettingUpdate {
  readonly providerId: string;
  readonly key: DirectorApiProviderSettingKey;
  readonly value: string | boolean;
  readonly now?: string;
}

export interface DirectorApiProviderConnectionTestInput {
  readonly providerId: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly now?: string;
  readonly fetchImpl?: DirectorApiProviderFetch;
}

export interface DirectorApiProviderConnectionTestResult {
  readonly providerId: string;
  readonly ok: boolean;
  readonly endpoint: string;
  readonly checkedAt: string;
  readonly latencyMs: number;
  readonly status?: number;
  readonly statusText?: string;
  readonly modelCount?: number;
  readonly message: string;
}

export interface DirectorApiProviderModelSyncInput {
  readonly providerId: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly now?: string;
  readonly fetchImpl?: DirectorApiProviderFetch;
}

export interface DirectorApiProviderModelSyncResult {
  readonly providerId: string;
  readonly ok: boolean;
  readonly pricingEndpoint: string;
  readonly modelsEndpoint: string;
  readonly syncedAt: string;
  readonly latencyMs: number;
  readonly count: number;
  readonly metadataCount: number;
  readonly endpointTypeCount: number;
  readonly pricingStatus?: number;
  readonly accountModelStatusCount: number;
  readonly message: string;
  readonly config: LoadDirectorApiProviderConfigResult;
}

export interface DirectorApiProviderTextCompletionInput {
  readonly providerId?: string;
  readonly prompt: string;
  readonly model?: string;
  readonly llmAdapter?:
    | "openai_chat"
    | "openai_responses"
    | "anthropic_messages"
    | "gemini_generate_content";
  readonly capabilityRoute?: DirectorApiProviderTextCompletionCapabilityRoute;
  readonly systemPrompt?: string;
  readonly messages?: readonly DirectorApiProviderTextMessage[];
  readonly referenceImages?: readonly string[];
  readonly tools?: readonly DirectorApiProviderToolDefinition[];
  readonly onStreamDelta?: (delta: string) => void;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly now?: string;
  readonly fetchImpl?: DirectorApiProviderFetch;
  readonly signal?: AbortSignal;
}

export type DirectorApiProviderTextCompletionAbilityGroup =
  | "text"
  | "vision"
  | "image_generation"
  | "video_generation";

export interface DirectorApiProviderTextCompletionCapabilityRoute {
  readonly abilityGroup: DirectorApiProviderTextCompletionAbilityGroup;
  readonly intentKind?: string;
  readonly inputModalities?: readonly string[];
  readonly outputModality?: string;
  readonly requiresMediaUnderstanding?: boolean;
  readonly explicitGeneration?: boolean;
  readonly reason?: string;
  readonly textModelCanHandleVision?: boolean;
  readonly modelAbilityGroups?: readonly DirectorApiProviderTextCompletionAbilityGroup[];
}

export type DirectorApiProviderTextMessageRole = "system" | "user" | "assistant" | "tool";

export type DirectorApiProviderTextContentPart =
  | {
      readonly type: "text";
      readonly text: string;
    }
  | {
      readonly type: "image_url";
      readonly image_url: {
        readonly url: string;
      };
    };

export interface DirectorApiProviderTextMessage {
  readonly role: DirectorApiProviderTextMessageRole;
  readonly content: string | readonly DirectorApiProviderTextContentPart[];
  readonly toolCallId?: string;
  readonly toolCalls?: readonly DirectorApiProviderToolCall[];
}

export interface DirectorApiProviderToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: unknown;
}

export interface DirectorApiProviderToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface DirectorApiProviderTextCompletionResult {
  readonly providerId: string;
  readonly ok: boolean;
  readonly endpoint: string;
  readonly checkedAt: string;
  readonly latencyMs: number;
  readonly model: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly output?: string;
  readonly toolCalls?: readonly DirectorApiProviderToolCall[];
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly retryCount?: number;
  readonly fallbackKeysTried?: number;
  readonly fallbackModelsTried?: readonly string[];
  readonly message: string;
}

export interface DirectorApiProviderImageGenerationInput {
  readonly providerId?: string;
  readonly prompt: string;
  readonly model?: string;
  readonly size?: string;
  readonly aspectRatio?: string;
  readonly resolution?: string;
  readonly quality?: string;
  readonly negativePrompt?: string;
  readonly referenceImages?: readonly string[];
  readonly n?: number;
  readonly responseFormat?: string;
  readonly outputFormat?: string;
  readonly timeoutMs?: number;
  readonly now?: string;
  readonly fetchImpl?: DirectorApiProviderFetch;
  readonly signal?: AbortSignal;
}

export interface DirectorApiProviderGeneratedImage {
  readonly url?: string;
  readonly b64Json?: string;
  readonly revisedPrompt?: string;
}

export interface DirectorApiProviderImageGenerationResult {
  readonly providerId: string;
  readonly ok: boolean;
  readonly endpoint: string;
  readonly checkedAt: string;
  readonly latencyMs: number;
  readonly model: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly images: readonly DirectorApiProviderGeneratedImage[];
  readonly output?: string;
  readonly retryCount?: number;
  readonly fallbackKeysTried?: number;
  readonly message: string;
}

export type SpeechToTextSourceKind =
  | "desktop-recording"
  | "file-ref"
  | "inline-bytes"
  | "upload"
  | "weixin-voice";

export interface SpeechToTextAudioSource {
  readonly kind: SpeechToTextSourceKind;
  readonly path?: string;
  readonly messageId?: string;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
  readonly durationMs?: number;
  readonly sha256?: string;
}

export interface SpeechToTextSegment {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly final: boolean;
  readonly speaker?: string;
}

export interface SpeechToTextProviderSideEffects {
  readonly microphoneAccessed: boolean;
  readonly rawAudioPersisted: boolean;
  readonly providerCredentialsUsed: boolean;
  readonly networkUsed: boolean;
  readonly localProcessStarted: boolean;
  readonly whisperStarted: boolean;
}

export interface SpeechToTextTranscriptionInput {
  readonly providerId: string;
  readonly source: SpeechToTextAudioSource;
  readonly model?: string;
  readonly language?: string;
}

export interface SpeechToTextTranscriptionSuccess {
  readonly ok: true;
  readonly providerId: string;
  readonly model: string;
  readonly transcript: string;
  readonly language?: string;
  readonly durationMs?: number;
  readonly segments: readonly SpeechToTextSegment[];
  readonly artifact: SpeechToTextTranscriptArtifact;
  readonly memoryWrite: false;
  readonly sideEffects: SpeechToTextProviderSideEffects;
}

export interface SpeechToTextTranscriptionBlocked {
  readonly ok: false;
  readonly status: "blocked";
  readonly providerId?: string;
  readonly reason: string;
  readonly sideEffects: SpeechToTextProviderSideEffects;
}

export type SpeechToTextTranscriptionResult =
  | SpeechToTextTranscriptionBlocked
  | SpeechToTextTranscriptionSuccess;

export interface SpeechToTextProviderDiagnosis {
  readonly ok: boolean;
  readonly status: "blocked" | "ready";
  readonly providerId: string;
  readonly reason: string;
  readonly models: readonly string[];
  readonly sideEffects: SpeechToTextProviderSideEffects;
}

export interface SpeechToTextProviderPlugin {
  readonly id: string;
  readonly displayName: string;
  readonly capabilityId: "audio.transcribe";
  readonly sideEffects: SpeechToTextProviderSideEffects;
  isConfigured(): boolean | Promise<boolean>;
  listModels(): readonly string[] | Promise<readonly string[]>;
  diagnose(): SpeechToTextProviderDiagnosis | Promise<SpeechToTextProviderDiagnosis>;
  transcribe(input: SpeechToTextTranscriptionInput): Promise<{
    readonly ok: boolean;
    readonly providerId?: string;
    readonly model?: string;
    readonly transcript?: string;
    readonly language?: string;
    readonly durationMs?: number;
    readonly segments?: readonly SpeechToTextSegment[];
    readonly reason?: string;
  }>;
}

export interface SpeechToTextTranscriptArtifact {
  readonly id: string;
  readonly kind: "text";
  readonly capabilityId: "audio.transcribe";
  readonly text: string;
  readonly memoryWrite: false;
  readonly metadata: {
    readonly sourceKind: SpeechToTextSourceKind;
    readonly providerId: string;
    readonly model?: string;
    readonly mimeType?: string;
    readonly language?: string;
    readonly durationMs?: number;
    readonly rawAudioPersisted: false;
  };
}

export interface SpeechToTextProviderRegistry {
  readonly list: () => readonly SpeechToTextProviderPlugin[];
  readonly resolve: (providerId: string) => SpeechToTextProviderPlugin | null;
}

export type SpeechSynthesisFormat = "aac" | "mp3" | "opus" | "wav";

export interface SpeechProviderSideEffects {
  readonly speakerAccessed: boolean;
  readonly providerCredentialsUsed: boolean;
  readonly networkUsed: boolean;
  readonly localProcessStarted: boolean;
  readonly autoplayed: boolean;
  readonly rawTextPersisted: boolean;
}

export interface SpeechProviderDiagnosis {
  readonly ok: boolean;
  readonly status: "blocked" | "ready";
  readonly providerId: string;
  readonly reason: string;
  readonly models: readonly string[];
  readonly voices: readonly string[];
  readonly sideEffects: SpeechProviderSideEffects;
}

export interface SpeechSynthesisInput {
  readonly providerId: string;
  readonly text: string;
  readonly model?: string;
  readonly voice?: string;
  readonly format?: SpeechSynthesisFormat;
  readonly autoplay?: boolean;
  readonly maxTextLength?: number;
}

export interface SpeechSynthesisAudio {
  readonly uri: string;
  readonly mimeType: string;
  readonly sizeBytes?: number;
  readonly durationMs?: number;
}

export interface SpeechSynthesisArtifact {
  readonly id: string;
  readonly kind: "audio";
  readonly capabilityId: "audio.synthesize";
  readonly uri: string;
  readonly mimeType: string;
  readonly memoryWrite: false;
  readonly metadata: {
    readonly providerId: string;
    readonly model?: string;
    readonly voice?: string;
    readonly format?: SpeechSynthesisFormat;
    readonly durationMs?: number;
    readonly sizeBytes?: number;
    readonly rawTextPersisted: false;
    readonly autoplay: false;
  };
}

export interface SpeechSynthesisSuccess {
  readonly ok: true;
  readonly providerId: string;
  readonly model: string;
  readonly voice: string;
  readonly normalizedText: string;
  readonly autoplay: false;
  readonly memoryWrite: false;
  readonly artifact: SpeechSynthesisArtifact;
  readonly sideEffects: SpeechProviderSideEffects;
}

export interface SpeechSynthesisBlocked {
  readonly ok: false;
  readonly status: "blocked";
  readonly providerId?: string;
  readonly reason: string;
  readonly sideEffects: SpeechProviderSideEffects;
}

export type SpeechSynthesisResult = SpeechSynthesisBlocked | SpeechSynthesisSuccess;

export interface SpeechProviderPlugin {
  readonly id: string;
  readonly displayName: string;
  readonly capabilityId: "audio.synthesize";
  readonly sideEffects: SpeechProviderSideEffects;
  isConfigured(): boolean | Promise<boolean>;
  listModels(): readonly string[] | Promise<readonly string[]>;
  listVoices(): readonly string[] | Promise<readonly string[]>;
  diagnose(): SpeechProviderDiagnosis | Promise<SpeechProviderDiagnosis>;
  synthesize(input: SpeechSynthesisInput & { readonly normalizedText: string }): Promise<{
    readonly ok: boolean;
    readonly providerId?: string;
    readonly model?: string;
    readonly voice?: string;
    readonly audio?: SpeechSynthesisAudio;
    readonly reason?: string;
  }>;
}

export interface SpeechProviderRegistry {
  readonly list: () => readonly SpeechProviderPlugin[];
  readonly resolve: (providerId: string) => SpeechProviderPlugin | null;
}

export type LocalWhisperProviderId = "local-faster-whisper" | "local-whisper-cli";

export interface LocalWhisperCommandPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly networkPolicy: "none";
  readonly stdin: false;
  readonly shell: false;
  readonly readableRoots: readonly string[];
  readonly writableRoots: readonly string[];
  readonly metadata: {
    readonly providerId: LocalWhisperProviderId;
    readonly model: string;
    readonly inputPath: string;
    readonly outputDir: string;
    readonly outputFormat: "json";
  };
}

export interface LocalWhisperPlanReady {
  readonly ok: true;
  readonly status: "ready";
  readonly providerId: LocalWhisperProviderId;
  readonly plan: LocalWhisperCommandPlan;
  readonly sideEffects: SpeechToTextProviderSideEffects;
}

export interface LocalWhisperPlanBlocked {
  readonly ok: false;
  readonly status: "blocked";
  readonly providerId: LocalWhisperProviderId;
  readonly reason: string;
  readonly sideEffects: SpeechToTextProviderSideEffects;
}

export type LocalWhisperTranscriptionPlan = LocalWhisperPlanBlocked | LocalWhisperPlanReady;

export interface LocalWhisperTranscriptionPlanInput {
  readonly providerId: LocalWhisperProviderId;
  readonly executable: string;
  readonly inputPath: string;
  readonly outputDir: string;
  readonly allowedInputRoots: readonly string[];
  readonly allowedOutputRoots: readonly string[];
  readonly model?: string;
  readonly language?: string;
  readonly timeoutMs?: number;
}

export interface LocalWhisperSandboxCommandRunnerResult {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly sandbox?: {
    readonly ok: boolean;
    readonly status: string;
    readonly providerId?: string;
    readonly evidence?: Readonly<Record<string, unknown>>;
    readonly reason?: string;
  };
}

export type LocalWhisperSandboxCommandRunner = (request: {
  readonly providerId: LocalWhisperProviderId;
  readonly operationId: "audio.transcribe.local-whisper";
  readonly plan: LocalWhisperCommandPlan;
}) => LocalWhisperSandboxCommandRunnerResult | Promise<LocalWhisperSandboxCommandRunnerResult>;

export type LocalWhisperUnsafeCommandRunner = (
  command: string,
  args: readonly string[],
  options: {
    readonly timeoutMs: number;
    readonly cwd?: string;
  },
) => LocalWhisperSandboxCommandRunnerResult | Promise<LocalWhisperSandboxCommandRunnerResult>;

export type LocalWhisperTranscriptionRunInput = LocalWhisperTranscriptionPlanInput & {
  readonly sandboxCommandRunner?: LocalWhisperSandboxCommandRunner;
  readonly commandRunner?: LocalWhisperUnsafeCommandRunner;
  readonly unsafeAllowRawCommandRunner?: boolean;
};

export interface LocalWhisperTranscriptionSuccess {
  readonly ok: true;
  readonly status: "completed";
  readonly providerId: LocalWhisperProviderId;
  readonly transcript: string;
  readonly stdoutSummary: string;
  readonly stderrSummary: string;
  readonly sideEffects: SpeechToTextProviderSideEffects;
  readonly sandbox?: LocalWhisperSandboxCommandRunnerResult["sandbox"];
}

export interface LocalWhisperTranscriptionBlocked {
  readonly ok: false;
  readonly status: "blocked";
  readonly providerId: LocalWhisperProviderId;
  readonly reason: string;
  readonly stdoutSummary: string;
  readonly stderrSummary: string;
  readonly sideEffects: SpeechToTextProviderSideEffects;
  readonly sandbox?: LocalWhisperSandboxCommandRunnerResult["sandbox"];
}

export type LocalWhisperTranscriptionRunResult =
  | LocalWhisperTranscriptionBlocked
  | LocalWhisperTranscriptionSuccess;

export interface DirectorMemefastLiveRunDriverOptions {
  readonly fetchImpl?: DirectorApiProviderFetch;
  readonly timeoutMs?: number;
  readonly maxTextAttempts?: number;
  readonly apiKeySlot?: number;
}

interface DirectorApiProviderFetchInit {
  readonly method: "GET" | "POST";
  readonly headers: Record<string, string>;
  readonly body?: string | FormData;
  readonly signal?: AbortSignal;
}

type DirectorApiProviderFetch = (
  url: string,
  init: DirectorApiProviderFetchInit,
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly body?: ReadableStream<Uint8Array> | null;
  readonly headers?: { get(name: string): string | null };
  text(): Promise<string>;
}>;

interface StoredDirectorApiProvider {
  readonly id: string;
  readonly platform?: string;
  readonly name?: string;
  readonly baseUrl?: string;
  readonly enabled?: boolean;
  readonly apiKey?: string;
  readonly apiKeyEnvVar?: string;
  readonly models?: readonly string[];
  readonly capabilities?: readonly DirectorApiProviderCapability[];
  readonly contextLimit?: number;
  readonly defaultModels?: Partial<DirectorApiProviderDefaults>;
  readonly modelEndpointTypes?: Readonly<Record<string, readonly string[]>>;
  readonly modelTypes?: Readonly<Record<string, string>>;
  readonly modelTags?: Readonly<Record<string, readonly string[]>>;
  readonly modelEnableGroups?: Readonly<Record<string, readonly string[]>>;
}

interface StoredDirectorApiProviderConfigDocument {
  readonly schemaVersion: typeof DIRECTOR_API_PROVIDER_CONFIG_SCHEMA_VERSION;
  readonly updatedAt: string;
  readonly providers: readonly StoredDirectorApiProvider[];
}

type DirectorApiProviderModelVisibilityStatus = "visible" | "invisible" | "unknown";

interface DirectorApiProviderKeyRoutingHint {
  readonly groupLabels: readonly string[];
  readonly groupKey: string;
  readonly source: "model_visibility_inferred" | "unknown";
  readonly visibility: DirectorApiProviderModelVisibilityStatus;
}

interface DirectorApiProviderPlannedApiKey {
  readonly apiKey: string;
  readonly originalIndex: number;
  readonly routingHint: DirectorApiProviderKeyRoutingHint;
}

interface DirectorApiProviderKeyFailureClassification {
  readonly retryable: boolean;
  readonly blacklistKey: boolean;
  readonly reason: "rate_limit" | "auth" | "service_unavailable" | "model_incompatible" | "unknown";
}

interface DirectorApiProviderModelInventoryCacheEntry {
  readonly checkedAt: number;
  readonly status: DirectorApiProviderModelVisibilityStatus;
  readonly modelIds: readonly string[];
}

const MEMEFAST_MODELS = [
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
  "deepseek-v3.2",
  "glm-4.7",
  "glm-5",
  "gemini-3-pro-preview-thinking",
  "gemini-3-pro-preview",
  "gemini-3.1-pro-preview",
  "doubao-seedream-5-0-260128",
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
  "gpt-image-2",
  "gpt-image-2-all",
  "gpt-image-1.5",
  "sora-2",
  "sora-2-pro",
  "sora-2-all",
  "sora-2-pro-all",
  "sora-2-vip-all",
  "kling-omni-video",
  "kling-video",
  "omni-flash",
  "omni-flash-components",
  "doubao-seedance-1-0-lite-t2v-250428",
  "doubao-seedance-1-0-lite-i2v-250428",
  "doubao-seedance-1-0-pro-250528",
  "doubao-seedance-1-0-pro-fast-251015",
  "doubao-seedance-1-5-pro-251215",
  "doubao-seedance-2-0-260128",
  "doubao-seedance-2-0-fast-260128",
  "minimax/video-01",
  "veo3.1",
  "MiniMax-Hailuo-02",
  "MiniMax-Hailuo-2.3",
  "wan2.5-i2v-preview",
  "wan2.6-i2v",
  "wan2.6-i2v-flash",
  "grok-video-3",
  "grok-video-3-10s",
  "grok-video-3-15s",
  "pixverse-v5.5-t2v",
  "suno_music",
  "suno_lyrics",
  "suno_uploads",
  "happyhorse-1.0-i2v",
  "happyhorse-1.0-r2v",
  "happyhorse-1.0-t2v",
  "happyhorse-1.0-video-edit",
  "claude-haiku-4-5-20251001",
] as const;

const MEMEFAST_DEFAULT_TEXT_MODELS = [
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
  "gemini-3-pro-preview-thinking",
  "deepseek-v3.2",
  "glm-4.7",
  "glm-5",
] as const;

const MEMEFAST_DEFAULT_IMAGE_MODELS = [
  "doubao-seedream-5-0-260128",
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
] as const;

const MEMEFAST_DEFAULT_SORA_VIDEO_MODELS = [
  "sora-2",
  "sora-2-pro",
  "sora-2-all",
  "sora-2-pro-all",
  "sora-2-vip-all",
] as const;

const MEMEFAST_DEFAULT_VIDEO_BINDING_MODELS = [
  ...MEMEFAST_DEFAULT_SORA_VIDEO_MODELS,
  "kling-omni-video",
  "kling-video",
  "omni-flash",
  "omni-flash-components",
  "doubao-seedance-1-5-pro-251215",
  "minimax/video-01",
  "MiniMax-Hailuo-2.3",
  "wan2.5-i2v-preview",
  "wan2.6-i2v",
  "wan2.6-i2v-flash",
  "pixverse-v5.5-t2v",
] as const;

const MEMEFAST_DEFAULT_VISION_MODELS = [
  "gemini-3-pro-preview-thinking",
  "gemini-3-pro-preview",
  "gemini-3.1-pro-preview",
] as const;

const MEMEFAST_DEFAULT_AUDIO_MODELS = ["suno_music", "suno_lyrics"] as const;

const MEMEFAST_CAPABILITIES = [
  "text",
  "vision",
  "image_generation",
  "video_generation",
  "audio_generation",
] as const satisfies readonly DirectorApiProviderCapability[];

const MEMEFAST_BRAND_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly brandId: string;
}[] = [
  { pattern: /^(gpt-|o[1-9]|dall-e|dalle|chatgpt|sora|codex)/iu, brandId: "openai" },
  { pattern: /^gpt[-_]?image/iu, brandId: "openai" },
  {
    pattern: /^(text-(embedding|babbage|curie|davinci|search)|davinci-|tts-|whisper)/iu,
    brandId: "openai",
  },
  { pattern: /^claude/iu, brandId: "anthropic" },
  { pattern: /^(gemini|gemma|veo|palm|bard)/iu, brandId: "google" },
  { pattern: /^google\//iu, brandId: "google" },
  { pattern: /^deepseek/iu, brandId: "deepseek" },
  { pattern: /^(glm|cogview|cogvideo|chatglm)/iu, brandId: "zhipu" },
  { pattern: /^(doubao|seed[- ]?oss)/iu, brandId: "doubao" },
  { pattern: /^(doubao-)?seed(ance|dream)/iu, brandId: "doubao" },
  { pattern: /^kling/iu, brandId: "kling" },
  { pattern: /^(mj_|midjourney|niji)/iu, brandId: "midjourney" },
  { pattern: /^(flux[-_.]|black-forest)/iu, brandId: "flux" },
  { pattern: /^grok/iu, brandId: "grok" },
  { pattern: /^(qwen|wan|tongyi|alibaba|bailian|qvq|qwq)/iu, brandId: "alibaba" },
  { pattern: /^(moonshot|kimi)/iu, brandId: "moonshot" },
  { pattern: /^(minimax|hailuo|speech-|audio[0-9]|mimo)/iu, brandId: "minimax" },
  { pattern: /^(ollama|llama|meta-llama)/iu, brandId: "ollama" },
  { pattern: /^(mistral|mixtral|dolphin)/iu, brandId: "mistral" },
  { pattern: /^hunyuan/iu, brandId: "hunyuan" },
  { pattern: /^vidu/iu, brandId: "vidu" },
  {
    pattern:
      /^(replicate|andreasjansson|stability-ai|cjwbw|lucataco|recraft-ai|riffusion|sujaykhandekar|prunaai)/iu,
    brandId: "replicate",
  },
  { pattern: /^(ernie|wenxin|Embedding-V)/u, brandId: "wenxin" },
  { pattern: /^(silicon|BAAI|Pro\/BAAI)/u, brandId: "siliconcloud" },
  { pattern: /^(spark|sparkdesk)/iu, brandId: "spark" },
  { pattern: /^fal[-_]ai\//iu, brandId: "fal" },
  { pattern: /^luma/iu, brandId: "luma" },
  { pattern: /^(runway|runwayml)/iu, brandId: "runway" },
  { pattern: /^ideogram/iu, brandId: "ideogram" },
  { pattern: /^suno/iu, brandId: "suno" },
];

const MEMEFAST_DEFAULT_MODELS = {
  text: "gemini-2.5-flash",
  vision: "gemini-3.1-pro-preview",
  image_generation: "gpt-image-2",
  video_generation: "sora-2",
  audio_generation: "suno_music",
} as const satisfies DirectorApiProviderDefaults;

const MEMEFAST_MODEL_VISIBILITY_CACHE_TTL_MS = 10 * 60 * 1000;
const memefastModelInventoryCache = new Map<string, DirectorApiProviderModelInventoryCacheEntry>();

const MEMEFAST_IMAGE_ENDPOINT_TYPE_MAP: Readonly<
  Record<string, DirectorApiProviderImageRouteFamily>
> = {
  "image-generation": "openai_images",
  "dall-e-3": "openai_images",
  "aigc-image": "openai_images",
  openai: "openai_chat",
  kling生图: "kling_image",
  "omni-image": "kling_image",
  文生图: "kling_image",
  gemini: "openai_chat",
};

const MEMEFAST_VIDEO_ENDPOINT_ROUTE_MAP: Readonly<
  Record<string, DirectorApiProviderVideoRouteFamily>
> = {
  openAI官方视频格式: "openai_official",
  openAI视频格式: "openai_official",
  豆包视频异步: "volc",
  异步: "wan",
  wan视频生成: "wan",
  文生视频: "kling",
  图生视频: "kling",
  视频延长: "kling",
  "omni-video": "kling",
  动作控制: "kling",
  多模态视频编辑: "kling",
  数字人: "kling",
  对口型: "kling",
  视频特效: "kling",
  openai: "unified",
  视频统一格式: "unified",
  grok视频: "unified",
  pixverse视频: "pixverse",
  "pixverse-video": "pixverse",
  "openai-response": "unified",
  海螺视频生成: "unified",
  luma视频生成: "unified",
  luma视频扩展: "unified",
  luma视频延长: "unified",
  runway图生视频: "unified",
  "aigc-video": "unified",
  vidu文生视频: "unified",
  vidu图生视频: "unified",
  vidu参考生视频: "unified",
  vidu首尾帧: "unified",
  happyhorse视频: "happyhorse",
  "minimax/video-01异步": "replicate",
  "minimax/video-01-live异步": "replicate",
};

const MEMEFAST_MODEL_ENDPOINT_TYPES: Readonly<Record<string, readonly string[]>> = {
  "doubao-seedream-5-0-260128": ["image-generation"],
  "gemini-3-pro-image-preview": ["gemini"],
  "gemini-3.1-flash-image-preview": ["gemini"],
  "gpt-image-2": ["image-generation"],
  "gpt-image-2-all": ["image-generation"],
  "gpt-image-1.5": ["image-generation"],
  "sora-2": ["openAI官方视频格式"],
  "sora-2-pro": ["openAI官方视频格式"],
  "sora-2-all": ["openAI官方视频格式"],
  "sora-2-pro-all": ["openAI官方视频格式"],
  "sora-2-vip-all": ["openAI官方视频格式"],
  "kling-omni-video": ["omni-video"],
  "kling-video": ["文生视频", "图生视频"],
  "doubao-seedance-1-0-lite-t2v-250428": ["豆包视频异步"],
  "doubao-seedance-1-0-lite-i2v-250428": ["豆包视频异步"],
  "doubao-seedance-1-0-pro-250528": ["豆包视频异步"],
  "doubao-seedance-1-0-pro-fast-251015": ["豆包视频异步"],
  "doubao-seedance-1-5-pro-251215": ["豆包视频异步"],
  "doubao-seedance-2-0-260128": ["豆包视频异步"],
  "doubao-seedance-2-0-fast-260128": ["豆包视频异步"],
  "minimax/video-01": ["minimax/video-01异步"],
  "veo3.1": ["openai-response"],
  "MiniMax-Hailuo-02": ["海螺视频生成"],
  "MiniMax-Hailuo-2.3": ["海螺视频生成"],
  "wan2.5-i2v-preview": ["异步"],
  "wan2.6-i2v": ["异步"],
  "wan2.6-i2v-flash": ["异步"],
  "grok-video-3": ["grok视频"],
  "grok-video-3-10s": ["grok视频"],
  "grok-video-3-15s": ["grok视频"],
  "pixverse-v5.5-t2v": ["pixverse视频"],
  "happyhorse-1.0-i2v": ["happyhorse视频"],
  "happyhorse-1.0-r2v": ["happyhorse视频"],
  "happyhorse-1.0-t2v": ["happyhorse视频"],
  "happyhorse-1.0-video-edit": ["happyhorse视频"],
  suno_music: ["suno音乐"],
  suno_lyrics: ["suno歌词"],
  suno_uploads: ["suno上传"],
};

const MEMEFAST_ENDPOINTS = [
  {
    id: "chat.completions",
    label: "Chat Completions",
    method: "POST",
    path: "/v1/chat/completions",
    routeFamily: "openai_chat",
    bodyFields: ["model", "messages", "temperature", "max_tokens"],
    notes: ["文本、视觉理解和部分 Gemini 图片模型的 OpenAI-compatible POST 路径。"],
  },
  {
    id: "image.generations",
    label: "Images Generations",
    method: "POST",
    path: "/v1/images/generations",
    routeFamily: "openai_images",
    bodyFields: ["model", "prompt", "n", "size", "quality", "format|output_format"],
    notes: ["gpt-image-2、seedream 等图片生成的默认 POST 路径。"],
  },
  {
    id: "image.edits",
    label: "Images Edits",
    method: "POST",
    path: "/v1/images/edits",
    routeFamily: "openai_image_edits",
    bodyFields: ["model", "prompt", "image|image[]", "n", "size", "quality"],
    notes: ["带参考图时使用；上传字段按模型在 image 和 image[] 之间切换。"],
  },
  {
    id: "video.create",
    label: "Video Create",
    method: "POST",
    path: "/v1/video/create",
    routeFamily: "memefast_unified_video",
    bodyFields: ["model", "prompt", "aspect_ratio", "size", "images"],
    notes: ["MemeFast 视频统一格式和 Grok 视频的 POST 路径。"],
  },
  {
    id: "video.generations",
    label: "Video Generations",
    method: "POST",
    path: "/v1/video/generations",
    routeFamily: "memefast_video_fallback",
    bodyFields: ["model", "prompt", "aspect_ratio", "duration", "image_url"],
    notes: ["代码中的默认视频 fallback 路径。"],
  },
  {
    id: "videos.official",
    label: "Official Videos",
    method: "POST",
    path: "/v1/videos",
    routeFamily: "openai_official_video",
    bodyFields: ["model", "prompt", "size", "seconds", "input_reference"],
    notes: ["OpenAI 官方视频格式；通常用 multipart FormData。"],
  },
  {
    id: "audio.music",
    label: "Suno Music",
    method: "POST",
    path: "/suno/submit/music",
    routeFamily: "suno",
    bodyFields: ["gpt_description_prompt|prompt", "mv", "title", "tags", "make_instrumental"],
    notes: ["Suno 音乐生成的 MemeFast POST 路径；不走图片/视频统一 body。"],
  },
  {
    id: "audio.lyrics",
    label: "Suno Lyrics",
    method: "POST",
    path: "/suno/submit/lyrics",
    routeFamily: "suno",
    bodyFields: ["prompt"],
    notes: ["Suno 歌词生成的 MemeFast POST 路径。"],
  },
  {
    id: "models.list",
    label: "Models",
    method: "GET",
    path: "/v1/models",
    routeFamily: "openai_models",
    bodyFields: [],
    notes: ["同步供应方模型清单和 endpoint metadata。"],
  },
] as const satisfies readonly DirectorApiProviderEndpoint[];

export function createMemefastApiProviderAdapter(
  override: Partial<StoredDirectorApiProvider> = {},
): DirectorApiProviderAdapter {
  const apiKeyEnvVar = override.apiKeyEnvVar ?? "MEMEFAST_API_KEY";
  const secret = firstApiKey(override.apiKey) ?? firstApiKey(process.env[apiKeyEnvVar]);
  const defaultModels = {
    ...MEMEFAST_DEFAULT_MODELS,
    ...(override.defaultModels ?? {}),
  };
  const models =
    override.models === undefined
      ? [...MEMEFAST_MODELS]
      : mergeMemefastSourceManagedModels(override.models);

  const provider: DirectorApiProviderAdapter = {
    id: override.id ?? "memefast-api",
    platform: override.platform ?? "memefast",
    name: override.name ?? "魔因API",
    baseUrl: normalizeBaseUrl(override.baseUrl ?? "https://memefast.top"),
    enabled: override.enabled ?? true,
    apiKeyEnvVar,
    apiKeyConfigured: secret !== undefined,
    apiKeyMasked: maskSecret(secret),
    models,
    capabilities:
      override.capabilities === undefined
        ? [...MEMEFAST_CAPABILITIES]
        : uniqueCapabilities([...override.capabilities, ...MEMEFAST_CAPABILITIES]),
    ...(override.contextLimit === undefined ? {} : { contextLimit: override.contextLimit }),
    defaultModels,
    advancedSettings: {
      compatibilityMode: "memefast_compatible",
      connectionTestFeature: "auto",
    },
    endpoints: [...MEMEFAST_ENDPOINTS],
    modelMetadata: createMemefastModelMetadata(models, override),
    featureBindings: createMemefastDefaultFeatureBindings({
      id: override.id ?? "memefast-api",
      models,
      ...(override.modelEndpointTypes === undefined
        ? {}
        : { modelEndpointTypes: override.modelEndpointTypes }),
      ...(override.modelTypes === undefined ? {} : { modelTypes: override.modelTypes }),
      ...(override.modelTags === undefined ? {} : { modelTags: override.modelTags }),
    }),
    notes: [
      "供应方结构参考 memefast IProvider；API key 只在本地配置或环境变量中保存，snapshot 只返回脱敏状态。",
      "真实 POST 路径来自 memefast 的 chat/image/video 适配层，供后续制作执行层复用。",
      "模型端点类型、服务映射和路由族从参考仓库 MemeFast API 管理内核复制为只读事实源。",
    ],
  };
  return provider;
}

export function createMemefastDefaultFeatureBindings(
  input: Pick<DirectorApiProviderAdapter, "id" | "models"> & {
    readonly modelEndpointTypes?: Readonly<Record<string, readonly string[]>>;
    readonly modelTypes?: Readonly<Record<string, string>>;
    readonly modelTags?: Readonly<Record<string, readonly string[]>>;
  },
): DirectorApiProviderFeatureBindings {
  const availableModels = uniqueStringArray([...input.models]);
  const availableModelSet = new Set(availableModels);
  const endpointTypesByModel = input.modelEndpointTypes ?? MEMEFAST_MODEL_ENDPOINT_TYPES;
  const createBindings = (models: readonly string[]) =>
    models.filter((model) => availableModelSet.has(model)).map((model) => `${input.id}:${model}`);
  const imageModels = availableModels.filter((model) =>
    classifyDirectorApiProviderModel(
      model,
      endpointTypesByModel[model],
      input.modelTypes?.[model],
      input.modelTags?.[model],
    ).includes("image_generation"),
  );
  const videoModels = prioritizeModels(
    availableModels.filter((model) =>
      classifyDirectorApiProviderModel(
        model,
        endpointTypesByModel[model],
        input.modelTypes?.[model],
        input.modelTags?.[model],
      ).includes("video_generation"),
    ),
    [...MEMEFAST_DEFAULT_VIDEO_BINDING_MODELS],
  );
  const audioModels = prioritizeModels(
    availableModels.filter((model) =>
      classifyDirectorApiProviderModel(
        model,
        endpointTypesByModel[model],
        input.modelTypes?.[model],
        input.modelTags?.[model],
      ).includes("audio_generation"),
    ),
    [...MEMEFAST_DEFAULT_AUDIO_MODELS],
  );

  return {
    script_analysis: createBindings(MEMEFAST_DEFAULT_TEXT_MODELS),
    character_generation: createBindings(MEMEFAST_DEFAULT_IMAGE_MODELS),
    scene_generation: createBindings(MEMEFAST_DEFAULT_IMAGE_MODELS),
    video_generation: createBindings(MEMEFAST_DEFAULT_VIDEO_BINDING_MODELS),
    image_understanding: createBindings(MEMEFAST_DEFAULT_VISION_MODELS),
    chat: createBindings(MEMEFAST_DEFAULT_TEXT_MODELS),
    freedom_image: imageModels.map((model) => `${input.id}:${model}`),
    freedom_video: videoModels.map((model) => `${input.id}:${model}`),
    freedom_music: audioModels.map((model) => `${input.id}:${model}`),
  };
}

export function resolveDirectorApiProviderImageRouteFamily(
  endpointTypes: readonly string[] | undefined,
  modelName?: string,
): DirectorApiProviderImageRouteFamily {
  const endpointRoute = endpointTypes
    ?.map((type) => MEMEFAST_IMAGE_ENDPOINT_TYPE_MAP[type])
    .find((route) => route === "kling_image");
  if (endpointRoute) {
    return endpointRoute;
  }
  const standardImageRoute = endpointTypes
    ?.map((type) => MEMEFAST_IMAGE_ENDPOINT_TYPE_MAP[type])
    .find((route) => route === "openai_images");
  if (standardImageRoute) {
    return standardImageRoute;
  }
  const chatRoute = endpointTypes
    ?.map((type) => MEMEFAST_IMAGE_ENDPOINT_TYPE_MAP[type])
    .find((route) => route === "openai_chat");
  if (chatRoute) {
    return chatRoute;
  }

  const name = modelName?.toLowerCase() ?? "";
  if (/^kling-(image|omni-image)$/iu.test(name) || /^kling-image/iu.test(name)) {
    return "kling_image";
  }
  if (name.includes("gemini") && (name.includes("image") || name.includes("imagen"))) {
    return "openai_chat";
  }
  if (
    /gpt-image|flux|dall-e|dalle|ideogram|stable-diffusion|sdxl|sd3|recraft|kolors|cogview|seedream/iu.test(
      name,
    )
  ) {
    return "openai_images";
  }
  return "unsupported";
}

export function resolveDirectorApiProviderVideoRouteFamily(
  endpointTypes: readonly string[] | undefined,
  modelName?: string,
): DirectorApiProviderVideoRouteFamily {
  for (const type of endpointTypes ?? []) {
    const mapped = MEMEFAST_VIDEO_ENDPOINT_ROUTE_MAP[type];
    if (mapped) {
      return mapped;
    }
    if (type.includes("/") && type.includes("异步")) {
      return "replicate";
    }
  }

  const name = modelName?.toLowerCase() ?? "";
  if (!name) {
    return "unknown";
  }
  if (/happyhorse/iu.test(name)) {
    return "happyhorse";
  }
  if (/sora|veo/iu.test(name)) {
    return "openai_official";
  }
  if (/seedance|doubao-seedance|doubao/iu.test(name)) {
    return "volc";
  }
  if (/wan/iu.test(name)) {
    return "wan";
  }
  if (/kling/iu.test(name)) {
    return "kling";
  }
  if (/pixverse/iu.test(name)) {
    return "pixverse";
  }
  if (/omni[-_ ]?flash/iu.test(name)) {
    return "unified";
  }
  if (/minimax\/video-01/iu.test(name)) {
    return "replicate";
  }
  if (/grok|runway|luma|hailuo|minimax|vidu/iu.test(name)) {
    return "unified";
  }
  return "unknown";
}

export function loadDirectorApiProviderConfig(
  rootPath: string,
): LoadDirectorApiProviderConfigResult {
  const path = configPath(rootPath);
  const notes: string[] = [];
  const issues: string[] = [];
  let source: "defaults" | "file" = "defaults";
  let storedProviders: readonly StoredDirectorApiProvider[] = [];
  let updatedAt = new Date(0).toISOString();

  if (existsSync(path)) {
    try {
      const parsed = parseStoredDocument(JSON.parse(readFileSync(path, "utf8")) as unknown);
      storedProviders = parsed.providers;
      updatedAt = parsed.updatedAt;
      source = "file";
      notes.push(`Loaded ${storedProviders.length} API provider configuration(s).`);
    } catch (error) {
      issues.push(`Failed to load API provider config: ${toErrorMessage(error)}.`);
      notes.push("API provider config could not be parsed; using built-in provider defaults.");
    }
  } else {
    notes.push("API provider config not found; using built-in memefast provider defaults.");
  }

  return {
    document: {
      schemaVersion: DIRECTOR_API_PROVIDER_CONFIG_SCHEMA_VERSION,
      updatedAt,
      providers: buildProviderAdapters(storedProviders),
    },
    configPath: path,
    source,
    notes,
    issues,
  };
}

export async function updateDirectorApiProviderSetting(
  rootPath: string,
  update: DirectorApiProviderSettingUpdate,
): Promise<LoadDirectorApiProviderConfigResult> {
  const existing = loadStoredDocument(rootPath);
  const now = update.now ?? new Date().toISOString();
  const providers = ensureStoredProviders(existing.providers);
  const index = providers.findIndex((provider) => provider.id === update.providerId);

  if (index < 0) {
    throw new Error(`Unknown API provider: ${update.providerId}`);
  }

  providers[index] = applyProviderSetting(providers[index] as StoredDirectorApiProvider, update);
  await writeStoredDocument(rootPath, {
    schemaVersion: DIRECTOR_API_PROVIDER_CONFIG_SCHEMA_VERSION,
    updatedAt: now,
    providers,
  });

  return loadDirectorApiProviderConfig(rootPath);
}

export async function testDirectorApiProviderConnection(
  rootPath: string,
  input: DirectorApiProviderConnectionTestInput,
): Promise<DirectorApiProviderConnectionTestResult> {
  const startedAt = Date.now();
  const checkedAt = input.now ?? new Date().toISOString();
  const storedProviders = ensureStoredProviders(loadStoredDocument(rootPath).providers);
  const stored = storedProviders.find((provider) => provider.id === input.providerId);
  const provider = buildProviderAdapters(storedProviders).find(
    (item) => item.id === input.providerId,
  );

  if (!provider || !stored) {
    throw new Error(`Unknown API provider: ${input.providerId}`);
  }

  const endpoint = provider.endpoints.find((item) => item.id === "models.list");
  const baseUrl = normalizeProviderRootBaseUrl(input.baseUrl ?? provider.baseUrl);
  const endpointUrl = `${baseUrl}${endpoint?.path ?? "/v1/models"}`;
  const apiKey =
    firstApiKey(input.apiKey) ??
    firstApiKey(stored.apiKey) ??
    firstApiKey(process.env[provider.apiKeyEnvVar]);

  if (!provider.enabled) {
    return connectionTestResult({
      input,
      checkedAt,
      startedAt,
      endpointUrl,
      ok: false,
      message: "供应方已停用，先启用后再测试。",
    });
  }

  if (!apiKey) {
    return connectionTestResult({
      input,
      checkedAt,
      startedAt,
      endpointUrl,
      ok: false,
      message: "没有可测试的 API Key。",
    });
  }

  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return connectionTestResult({
      input,
      checkedAt,
      startedAt,
      endpointUrl,
      ok: false,
      message: "当前运行环境没有 fetch，无法测试供应方连接。",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, input.timeoutMs ?? 12_000);

  try {
    const response = await fetchImpl(endpointUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    const body = await response.text();
    const modelCount = parseModelCount(body);
    return connectionTestResult({
      input,
      checkedAt,
      startedAt,
      endpointUrl,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      ...(modelCount === undefined ? {} : { modelCount }),
      message: response.ok
        ? `连接成功${modelCount === undefined ? "" : `，返回 ${modelCount} 个模型`}。`
        : `连接失败：HTTP ${response.status} ${response.statusText || ""}`.trim(),
    });
  } catch (error) {
    return connectionTestResult({
      input,
      checkedAt,
      startedAt,
      endpointUrl,
      ok: false,
      message: `连接失败：${toErrorMessage(error)}。`,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function syncDirectorApiProviderModels(
  rootPath: string,
  input: DirectorApiProviderModelSyncInput,
): Promise<DirectorApiProviderModelSyncResult> {
  const startedAt = Date.now();
  const syncedAt = input.now ?? new Date().toISOString();
  const existing = loadStoredDocument(rootPath);
  const providers = ensureStoredProviders(existing.providers);
  const index = providers.findIndex((provider) => provider.id === input.providerId);
  if (index < 0) {
    throw new Error(`Unknown API provider: ${input.providerId}`);
  }

  const stored = providers[index] as StoredDirectorApiProvider;
  const adapter = buildProviderAdapters(providers).find(
    (provider) => provider.id === input.providerId,
  );
  if (!adapter) {
    throw new Error(`Unknown API provider: ${input.providerId}`);
  }

  const baseUrl = normalizeBaseUrl(input.baseUrl ?? adapter.baseUrl);
  const rootBaseUrl = normalizeProviderRootBaseUrl(baseUrl);
  const pricingEndpoint = `${rootBaseUrl}/api/pricing_new`;
  const modelsEndpoint = buildModelsEndpoint(baseUrl);
  const apiKeys = resolveApiKeys(input.apiKey, stored.apiKey, process.env[adapter.apiKeyEnvVar]);

  if (!adapter.enabled) {
    return modelSyncResult({
      input,
      syncedAt,
      startedAt,
      pricingEndpoint,
      modelsEndpoint,
      ok: false,
      count: adapter.models.length,
      metadataCount: adapter.modelMetadata.length,
      endpointTypeCount: adapter.modelMetadata.filter(
        (metadata) => metadata.endpointTypes.length > 0,
      ).length,
      accountModelStatusCount: 0,
      message: "供应方已停用，先启用后再同步模型池。",
      config: loadDirectorApiProviderConfig(rootPath),
    });
  }

  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return modelSyncResult({
      input,
      syncedAt,
      startedAt,
      pricingEndpoint,
      modelsEndpoint,
      ok: false,
      count: adapter.models.length,
      metadataCount: adapter.modelMetadata.length,
      endpointTypeCount: adapter.modelMetadata.filter(
        (metadata) => metadata.endpointTypes.length > 0,
      ).length,
      accountModelStatusCount: 0,
      message: "当前运行环境没有 fetch，无法同步供应方模型池。",
      config: loadDirectorApiProviderConfig(rootPath),
    });
  }

  const modelIds = new Set(adapter.models);
  const modelEndpointTypes = cloneStringArrayRecord(stored.modelEndpointTypes);
  const modelTypes = cloneStringRecord(stored.modelTypes);
  const modelTags = cloneStringArrayRecord(stored.modelTags);
  const modelEnableGroups = cloneStringArrayRecord(stored.modelEnableGroups);
  const syncedMetadataModels = new Set<string>();
  const syncedEndpointTypeModels = new Set<string>();
  let pricingStatus: number | undefined;
  let accountModelStatusCount = 0;

  const pricingResponse = await fetchTextWithTimeout(fetchImpl, pricingEndpoint, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    timeoutMs: input.timeoutMs ?? 20_000,
  });
  pricingStatus = pricingResponse.status;
  if (!pricingResponse.ok) {
    return modelSyncResult({
      input,
      syncedAt,
      startedAt,
      pricingEndpoint,
      modelsEndpoint,
      ok: false,
      count: adapter.models.length,
      metadataCount: adapter.modelMetadata.length,
      endpointTypeCount: adapter.modelMetadata.filter(
        (metadata) => metadata.endpointTypes.length > 0,
      ).length,
      pricingStatus,
      accountModelStatusCount,
      message:
        `pricing_new API 返回 ${pricingResponse.status} ${pricingResponse.statusText || ""}`.trim(),
      config: loadDirectorApiProviderConfig(rootPath),
    });
  }

  const pricingModels = parseMemefastPricingModels(pricingResponse.body);
  for (const model of pricingModels) {
    modelIds.add(model.modelName);
    syncedMetadataModels.add(model.modelName);
    if (model.modelType !== undefined) {
      modelTypes[model.modelName] = model.modelType;
    }
    if (model.tags.length > 0) {
      modelTags[model.modelName] = [...model.tags];
    }
    if (model.endpointTypes.length > 0) {
      syncedEndpointTypeModels.add(model.modelName);
      modelEndpointTypes[model.modelName] = [...model.endpointTypes];
    }
    if (model.enableGroups.length > 0) {
      modelEnableGroups[model.modelName] = [...model.enableGroups];
    }
  }

  for (const apiKey of apiKeys) {
    const modelsResponse = await fetchTextWithTimeout(fetchImpl, modelsEndpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeoutMs: input.timeoutMs ?? 20_000,
    });
    if (!modelsResponse.ok) {
      continue;
    }
    accountModelStatusCount += 1;
    for (const model of parseModelListResponse(modelsResponse.body)) {
      modelIds.add(model.id);
      if (model.endpointTypes.length > 0) {
        syncedMetadataModels.add(model.id);
        syncedEndpointTypeModels.add(model.id);
        modelEndpointTypes[model.id] = [...model.endpointTypes];
      }
    }
  }

  const nextStored: StoredDirectorApiProvider = {
    ...stored,
    baseUrl,
    models: uniqueStringArray([...modelIds]),
    modelEndpointTypes,
    modelTypes,
    modelTags,
    modelEnableGroups,
  };
  providers[index] = nextStored;
  await writeStoredDocument(rootPath, {
    schemaVersion: DIRECTOR_API_PROVIDER_CONFIG_SCHEMA_VERSION,
    updatedAt: syncedAt,
    providers,
  });

  const config = loadDirectorApiProviderConfig(rootPath);
  const syncedProvider = config.document.providers.find(
    (provider) => provider.id === input.providerId,
  );
  const metadataCount = syncedProvider?.modelMetadata.length ?? 0;
  return modelSyncResult({
    input,
    syncedAt,
    startedAt,
    pricingEndpoint,
    modelsEndpoint,
    ok: true,
    count: syncedProvider?.models.length ?? nextStored.models?.length ?? 0,
    metadataCount: syncedMetadataModels.size,
    endpointTypeCount: syncedEndpointTypeModels.size,
    pricingStatus,
    accountModelStatusCount,
    message: `模型池同步完成，当前 ${syncedProvider?.models.length ?? nextStored.models?.length ?? 0} 个模型。`,
    config,
  });
}

export async function runDirectorApiProviderTextCompletion(
  rootPath: string,
  input: DirectorApiProviderTextCompletionInput,
): Promise<DirectorApiProviderTextCompletionResult> {
  const startedAt = Date.now();
  const checkedAt = input.now ?? new Date().toISOString();
  const storedProviders = ensureStoredProviders(loadStoredDocument(rootPath).providers);
  const providers = buildProviderAdapters(storedProviders);
  const provider = selectTextProvider(providers, input.providerId, input.capabilityRoute);

  if (!provider) {
    throw new Error(`Unknown API provider: ${input.providerId ?? "text-capable"}`);
  }

  const stored = storedProviders.find((item) => item.id === provider.id);
  const endpoint = provider.endpoints.find((item) => item.id === "chat.completions");
  const defaultEndpointUrl = `${normalizeProviderRootBaseUrl(provider.baseUrl)}${
    endpoint?.path ?? "/v1/chat/completions"
  }`;
  const models = resolveTextCompletionModels(provider, input.model, input.capabilityRoute);
  const apiKeys = resolveApiKeys(stored?.apiKey, process.env[provider.apiKeyEnvVar]);
  const model = models[0] ?? provider.defaultModels.text;
  const streamRequested = typeof input.onStreamDelta === "function";

  if (!provider.enabled) {
    return textCompletionResult({
      input,
      providerId: provider.id,
      checkedAt,
      startedAt,
      endpointUrl: defaultEndpointUrl,
      model,
      ok: false,
      message: "供应方已停用，先启用后再运行。",
    });
  }

  if (apiKeys.length === 0) {
    return textCompletionResult({
      input,
      providerId: provider.id,
      checkedAt,
      startedAt,
      endpointUrl: defaultEndpointUrl,
      model,
      ok: false,
      message: "没有可用的 API Key，无法运行模型调用。",
    });
  }

  const prompt = input.prompt.trim();
  if (!prompt) {
    return textCompletionResult({
      input,
      providerId: provider.id,
      checkedAt,
      startedAt,
      endpointUrl: defaultEndpointUrl,
      model,
      ok: false,
      message: "工作台输入为空，未发起模型调用。",
    });
  }

  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return textCompletionResult({
      input,
      providerId: provider.id,
      checkedAt,
      startedAt,
      endpointUrl: defaultEndpointUrl,
      model,
      ok: false,
      message: "当前运行环境没有 fetch，无法运行模型调用。",
    });
  }

  let lastFailure:
    | {
        readonly model: string;
        readonly status?: number;
        readonly statusText?: string;
        readonly message: string;
      }
    | undefined;
  let attemptCount = 0;
  let attemptedKeyCount = 0;
  const triedModels: string[] = [];
  const blockedKeysByModel = new Map<string, Set<string>>();
  let lastEndpointUrl = defaultEndpointUrl;

  const maxAttempts =
    typeof input.maxAttempts === "number" && Number.isFinite(input.maxAttempts)
      ? Math.max(1, Math.trunc(input.maxAttempts))
      : Number.POSITIVE_INFINITY;

  for (const attemptModel of models) {
    if (attemptCount >= maxAttempts) {
      break;
    }
    triedModels.push(attemptModel);
    let attemptsForModel = 0;
    const plannedKeys = await planDirectorApiProviderKeysForModel({
      provider,
      stored,
      model: attemptModel,
      apiKeys,
      timeoutMs: input.timeoutMs ?? DIRECTOR_TEXT_GENERATION_SUBMIT_TIMEOUT_MS,
      fetchImpl,
    });
    const blockedKeys = blockedKeysByModel.get(attemptModel) ?? new Set<string>();
    blockedKeysByModel.set(attemptModel, blockedKeys);
    const keyQueue = plannedKeys.filter((item) => !blockedKeys.has(item.apiKey));
    if (keyQueue.length === 0 && plannedKeys.length > 0) {
      keyQueue.push(...plannedKeys);
    }
    const usedGroups = new Set<string>();
    const retryQueue = [...keyQueue];
    for (let keyIndex = 0; keyIndex < retryQueue.length; keyIndex += 1) {
      if (input.signal?.aborted === true) {
        return textCompletionResult({
          input,
          providerId: provider.id,
          checkedAt,
          startedAt,
          endpointUrl: lastEndpointUrl,
          model: attemptModel,
          ok: false,
          retryCount: attemptCount,
          fallbackKeysTried: attemptedKeyCount,
          fallbackModelsTried: uniqueStringArray(triedModels),
          message: "模型调用已被停止。",
        });
      }
      if (attemptsForModel >= maxAttempts) {
        break;
      }
      if (attemptCount >= maxAttempts) {
        break;
      }
      const plannedKey = retryQueue[keyIndex] as DirectorApiProviderPlannedApiKey | undefined;
      if (!plannedKey) {
        continue;
      }
      const apiKey = plannedKey.apiKey;
      usedGroups.add(plannedKey.routingHint.groupKey);
      attemptCount += 1;
      attemptsForModel += 1;
      attemptedKeyCount += 1;
      const externalSignal = input.signal;
      const controller = externalSignal === undefined ? new AbortController() : undefined;
      const signal = externalSignal ?? controller?.signal;
      const timeout = setTimeout(() => {
        controller?.abort();
      }, input.timeoutMs ?? DIRECTOR_TEXT_GENERATION_SUBMIT_TIMEOUT_MS);
      const textRequestPlan = buildDirectorMemefastGenerationRequestPlan({
        mediaKind: "text",
        model: attemptModel,
        prompt,
        input: {
          messages: buildTextCompletionMessages(input, attemptModel),
          ...(input.llmAdapter === undefined ? {} : { llmAdapter: input.llmAdapter }),
          stream: streamRequested,
        },
      });
      const endpointUrl = toMemefastAbsoluteEndpoint(
        normalizeProviderRootBaseUrl(provider.baseUrl),
        textRequestPlan.endpointPath,
      );
      lastEndpointUrl = endpointUrl;
      const requestBody: Record<string, unknown> = {
        ...textRequestPlan.body,
        ...(textRequestPlan.adapter === "openai-chat-llm" &&
        input.tools !== undefined &&
        input.tools.length > 0
          ? {
              tools: input.tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema ?? { type: "object", properties: {} },
                },
              })),
              tool_choice: "auto",
            }
          : {}),
      };

      try {
        const response = await fetchImpl(endpointUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          ...(signal === undefined ? {} : { signal }),
        });
        if (!response.ok) {
          const body = await response.text();
          const failure = classifyTextCompletionKeyFailure(response.status, body);
          if (failure.blacklistKey) {
            blockedKeys.add(apiKey);
            reorderDirectorApiProviderRetryQueueByRoutingGroup({
              queue: retryQueue,
              cursorIndex: keyIndex,
              usedGroups,
              blockedKeys,
            });
          }
          lastFailure = {
            model: attemptModel,
            status: response.status,
            statusText: response.statusText,
            message: `模型调用失败：HTTP ${response.status} ${response.statusText || ""}`.trim(),
          };
          if (shouldRetryTextCompletionFailure(response.status, undefined)) {
            continue;
          }
          return textCompletionResult({
            input,
            providerId: provider.id,
            checkedAt,
            startedAt,
            endpointUrl,
            model: attemptModel,
            ok: false,
            status: response.status,
            statusText: response.statusText,
            message: `模型调用失败：HTTP ${response.status} ${response.statusText || ""}`.trim(),
            retryCount: attemptCount - 1,
            fallbackKeysTried: attemptedKeyCount,
            fallbackModelsTried: uniqueStringArray(triedModels),
          });
        }
        if (streamRequested) {
          const parsed = await consumeTextCompletionStreamResponse(response, input.onStreamDelta);
          const output = parsed.output?.trim();
          const ok =
            response.ok &&
            ((output !== undefined && output.length > 0) || (parsed.toolCalls?.length ?? 0) > 0);
          if (ok || !shouldRetryTextCompletionFailure(response.status, undefined)) {
            return textCompletionResult({
              input,
              providerId: provider.id,
              checkedAt,
              startedAt,
              endpointUrl,
              model: attemptModel,
              ok,
              status: response.status,
              statusText: response.statusText,
              ...(output ? { output } : {}),
              ...(parsed.toolCalls === undefined ? {} : { toolCalls: parsed.toolCalls }),
              ...(parsed.promptTokens === undefined ? {} : { promptTokens: parsed.promptTokens }),
              ...(parsed.completionTokens === undefined
                ? {}
                : { completionTokens: parsed.completionTokens }),
              retryCount: attemptCount - 1,
              fallbackKeysTried: attemptedKeyCount,
              fallbackModelsTried: uniqueStringArray(triedModels),
              message: ok
                ? attemptCount > 1
                  ? `模型调用完成；已自动切换 ${attemptCount - 1} 次。`
                  : "模型调用完成。"
                : response.ok
                  ? "供应方响应中没有文本输出。"
                  : `模型调用失败：HTTP ${response.status} ${response.statusText || ""}`.trim(),
            });
          }
        } else {
          const body = await response.text();
          const parsed = parseTextCompletionResponse(body);
          const output = parsed.output?.trim();
          const ok =
            response.ok &&
            ((output !== undefined && output.length > 0) || (parsed.toolCalls?.length ?? 0) > 0);
          if (ok || !shouldRetryTextCompletionFailure(response.status, undefined)) {
            return textCompletionResult({
              input,
              providerId: provider.id,
              checkedAt,
              startedAt,
              endpointUrl,
              model: attemptModel,
              ok,
              status: response.status,
              statusText: response.statusText,
              ...(output ? { output } : {}),
              ...(parsed.toolCalls === undefined ? {} : { toolCalls: parsed.toolCalls }),
              ...(parsed.promptTokens === undefined ? {} : { promptTokens: parsed.promptTokens }),
              ...(parsed.completionTokens === undefined
                ? {}
                : { completionTokens: parsed.completionTokens }),
              retryCount: attemptCount - 1,
              fallbackKeysTried: attemptedKeyCount,
              fallbackModelsTried: uniqueStringArray(triedModels),
              message: ok
                ? attemptCount > 1
                  ? `模型调用完成；已自动切换 ${attemptCount - 1} 次。`
                  : "模型调用完成。"
                : response.ok
                  ? "供应方响应中没有文本输出。"
                  : `模型调用失败：HTTP ${response.status} ${response.statusText || ""}`.trim(),
            });
          }
        }
      } catch (error) {
        const errorMessage = toErrorMessage(error);
        if (externalSignal?.aborted === true) {
          return textCompletionResult({
            input,
            providerId: provider.id,
            checkedAt,
            startedAt,
            endpointUrl,
            model: attemptModel,
            ok: false,
            retryCount: attemptCount - 1,
            fallbackKeysTried: attemptedKeyCount,
            fallbackModelsTried: uniqueStringArray(triedModels),
            message: `模型调用已被停止：${errorMessage}。`,
          });
        }
        if (!shouldRetryTextCompletionFailure(undefined, error)) {
          return textCompletionResult({
            input,
            providerId: provider.id,
            checkedAt,
            startedAt,
            endpointUrl,
            model: attemptModel,
            ok: false,
            retryCount: attemptCount - 1,
            fallbackKeysTried: attemptedKeyCount,
            fallbackModelsTried: uniqueStringArray(triedModels),
            message: `模型调用失败：${errorMessage}。`,
          });
        }
        blockedKeys.add(apiKey);
        reorderDirectorApiProviderRetryQueueByRoutingGroup({
          queue: retryQueue,
          cursorIndex: keyIndex,
          usedGroups,
          blockedKeys,
        });
        lastFailure = {
          model: attemptModel,
          message: `模型调用失败：${errorMessage}。`,
        };
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  return textCompletionResult({
    input,
    providerId: provider.id,
    checkedAt,
    startedAt,
    endpointUrl: lastEndpointUrl,
    model: lastFailure?.model ?? model,
    ok: false,
    ...(lastFailure?.status === undefined ? {} : { status: lastFailure.status }),
    ...(lastFailure?.statusText === undefined ? {} : { statusText: lastFailure.statusText }),
    retryCount: Math.max(0, attemptCount - 1),
    fallbackKeysTried: attemptedKeyCount,
    fallbackModelsTried: uniqueStringArray(triedModels),
    message:
      attemptCount > 1 && lastFailure !== undefined
        ? `${lastFailure.message}；已尝试 ${attemptCount} 次可用 API Key/模型组合。`
        : (lastFailure?.message ?? "模型调用失败。"),
  });
}

export async function runDirectorApiProviderImageGeneration(
  rootPath: string,
  input: DirectorApiProviderImageGenerationInput,
): Promise<DirectorApiProviderImageGenerationResult> {
  const startedAt = Date.now();
  const checkedAt = input.now ?? new Date().toISOString();
  const storedProviders = ensureStoredProviders(loadStoredDocument(rootPath).providers);
  const providers = buildProviderAdapters(storedProviders);
  const provider = selectImageProvider(providers, input.providerId);

  if (!provider) {
    throw new Error(`Unknown API provider: ${input.providerId ?? "image-capable"}`);
  }

  const stored = storedProviders.find((item) => item.id === provider.id);
  const endpoint = provider.endpoints.find((item) => item.id === "image.generations");
  const defaultEndpointUrl = `${normalizeProviderRootBaseUrl(provider.baseUrl)}${
    endpoint?.path ?? "/v1/images/generations"
  }`;
  const model = input.model?.trim() || provider.defaultModels.image_generation;
  const endpointTypes = resolveDirectorApiProviderModelEndpointTypes(provider, model);
  const imageRouteFamily =
    provider.modelMetadata.find((item) => item.model === model)?.imageRouteFamily ??
    resolveDirectorApiProviderImageRouteFamily(endpointTypes, model);
  const apiKeys = resolveApiKeys(stored?.apiKey, process.env[provider.apiKeyEnvVar]);

  if (!provider.enabled) {
    return imageGenerationResult({
      input,
      providerId: provider.id,
      checkedAt,
      startedAt,
      endpointUrl: defaultEndpointUrl,
      model,
      ok: false,
      images: [],
      message: "供应方已停用，先启用后再生成图片。",
    });
  }

  if (apiKeys.length === 0) {
    return imageGenerationResult({
      input,
      providerId: provider.id,
      checkedAt,
      startedAt,
      endpointUrl: defaultEndpointUrl,
      model,
      ok: false,
      images: [],
      message: "没有可用的 API Key，无法生成图片。",
    });
  }

  const prompt = input.prompt.trim();
  if (!prompt) {
    return imageGenerationResult({
      input,
      providerId: provider.id,
      checkedAt,
      startedAt,
      endpointUrl: defaultEndpointUrl,
      model,
      ok: false,
      images: [],
      message: "图片生成提示词为空，未发起调用。",
    });
  }

  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return imageGenerationResult({
      input,
      providerId: provider.id,
      checkedAt,
      startedAt,
      endpointUrl: defaultEndpointUrl,
      model,
      ok: false,
      images: [],
      message: "当前运行环境没有 fetch，无法生成图片。",
    });
  }

  const plannedKeys = await planDirectorApiProviderKeysForModel({
    provider,
    stored,
    model,
    apiKeys,
    timeoutMs: input.timeoutMs ?? DIRECTOR_MEDIA_GENERATION_SUBMIT_TIMEOUT_MS,
    fetchImpl,
  });
  const blockedKeys = new Set<string>();
  const usedGroups = new Set<string>();
  const retryQueue = [...plannedKeys];
  let attemptCount = 0;
  let lastFailure:
    | {
        readonly status?: number;
        readonly statusText?: string;
        readonly message: string;
      }
    | undefined;
  let lastEndpointUrl = defaultEndpointUrl;

  for (let keyIndex = 0; keyIndex < retryQueue.length; keyIndex += 1) {
    if (input.signal?.aborted === true) {
      return imageGenerationResult({
        input,
        providerId: provider.id,
        checkedAt,
        startedAt,
        endpointUrl: defaultEndpointUrl,
        model,
        ok: false,
        images: [],
        retryCount: attemptCount,
        fallbackKeysTried: attemptCount,
        message: "图片生成已被停止。",
      });
    }
    const plannedKey = retryQueue[keyIndex] as DirectorApiProviderPlannedApiKey | undefined;
    if (!plannedKey) {
      continue;
    }
    const apiKey = plannedKey.apiKey;
    usedGroups.add(plannedKey.routingHint.groupKey);
    attemptCount += 1;

    const externalSignal = input.signal;
    const controller = externalSignal === undefined ? new AbortController() : undefined;
    const signal = externalSignal ?? controller?.signal;
    const timeout = setTimeout(() => {
      controller?.abort();
    }, input.timeoutMs ?? DIRECTOR_MEDIA_GENERATION_SUBMIT_TIMEOUT_MS);

    try {
      const aspectRatioFromSize =
        input.aspectRatio ??
        (/^\d+\s*:\s*\d+$/u.test(input.size?.trim() ?? "") ? input.size?.trim() : undefined);
      const requestPlan = buildDirectorMemefastGenerationRequestPlan({
        mediaKind: "image",
        model,
        prompt,
        routeFamily: imageRouteFamily,
        endpointTypes,
        input: {
          ...(input.size === undefined || aspectRatioFromSize === input.size.trim()
            ? {}
            : { size: input.size }),
          ...(aspectRatioFromSize === undefined ? {} : { aspectRatio: aspectRatioFromSize }),
          ...(input.resolution === undefined ? {} : { resolution: input.resolution }),
          ...(input.quality === undefined ? {} : { quality: input.quality }),
          ...(input.negativePrompt === undefined ? {} : { negativePrompt: input.negativePrompt }),
          ...(input.referenceImages === undefined
            ? {}
            : { referenceImages: input.referenceImages }),
          ...(input.n === undefined ? {} : { n: input.n }),
          ...(input.responseFormat === undefined ? {} : { response_format: input.responseFormat }),
          ...(input.outputFormat === undefined ? {} : { outputFormat: input.outputFormat }),
        },
      });
      const endpointUrl = toMemefastAbsoluteEndpoint(
        normalizeProviderRootBaseUrl(provider.baseUrl),
        requestPlan.endpointPath,
      );
      lastEndpointUrl = endpointUrl;
      const submitBody = await buildDirectorMemefastGenerationSubmitBody(requestPlan, {
        ...(signal === undefined ? {} : { signal }),
      });
      const response = await fetchImpl(endpointUrl, {
        method: "POST",
        headers: createDirectorMemefastGenerationSubmitHeaders(apiKey, submitBody),
        body: submitBody instanceof FormData ? submitBody : JSON.stringify(submitBody),
        ...(signal === undefined ? {} : { signal }),
      });
      const responseBody = await response.text();
      const parsed = parseImageGenerationResponse(responseBody);
      const ok = response.ok && parsed.images.length > 0;
      if (ok || !shouldRetryMediaProviderFailure(response.status, responseBody)) {
        return imageGenerationResult({
          input,
          providerId: provider.id,
          checkedAt,
          startedAt,
          endpointUrl: lastEndpointUrl,
          model,
          ok,
          status: response.status,
          statusText: response.statusText,
          images: parsed.images,
          ...(parsed.output === undefined ? {} : { output: parsed.output }),
          retryCount: attemptCount - 1,
          fallbackKeysTried: attemptCount,
          message: ok
            ? attemptCount > 1
              ? `图片生成完成；已自动切换 ${attemptCount - 1} 次。`
              : "图片生成完成。"
            : response.ok
              ? "供应方响应中没有图片结果。"
              : `图片生成失败：HTTP ${response.status} ${response.statusText || ""}`.trim(),
        });
      }
      const failure = classifyTextCompletionKeyFailure(response.status, responseBody);
      if (failure.blacklistKey) {
        blockedKeys.add(apiKey);
        reorderDirectorApiProviderRetryQueueByRoutingGroup({
          queue: retryQueue,
          cursorIndex: keyIndex,
          usedGroups,
          blockedKeys,
        });
      }
      lastFailure = {
        status: response.status,
        statusText: response.statusText,
        message: `图片生成失败：HTTP ${response.status} ${response.statusText || ""}`.trim(),
      };
    } catch (error) {
      if (externalSignal?.aborted === true) {
        return imageGenerationResult({
          input,
          providerId: provider.id,
          checkedAt,
          startedAt,
          endpointUrl: lastEndpointUrl,
          model,
          ok: false,
          images: [],
          retryCount: attemptCount - 1,
          fallbackKeysTried: attemptCount,
          message: `图片生成已被停止：${toErrorMessage(error)}。`,
        });
      }
      if (!shouldRetryMediaProviderFailure(undefined, toErrorMessage(error))) {
        return imageGenerationResult({
          input,
          providerId: provider.id,
          checkedAt,
          startedAt,
          endpointUrl: lastEndpointUrl,
          model,
          ok: false,
          images: [],
          retryCount: attemptCount - 1,
          fallbackKeysTried: attemptCount,
          message: `图片生成失败：${toErrorMessage(error)}。`,
        });
      }
      blockedKeys.add(apiKey);
      reorderDirectorApiProviderRetryQueueByRoutingGroup({
        queue: retryQueue,
        cursorIndex: keyIndex,
        usedGroups,
        blockedKeys,
      });
      lastFailure = {
        message: `图片生成失败：${toErrorMessage(error)}。`,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return imageGenerationResult({
    input,
    providerId: provider.id,
    checkedAt,
    startedAt,
    endpointUrl: lastEndpointUrl,
    model,
    ok: false,
    ...(lastFailure?.status === undefined ? {} : { status: lastFailure.status }),
    ...(lastFailure?.statusText === undefined ? {} : { statusText: lastFailure.statusText }),
    images: [],
    retryCount: Math.max(0, attemptCount - 1),
    fallbackKeysTried: attemptCount,
    message:
      attemptCount > 1 && lastFailure !== undefined
        ? `${lastFailure.message}；已尝试 ${attemptCount} 次可用 API Key。`
        : (lastFailure?.message ?? "图片生成失败。"),
  });
}

export function createMemefastLiveRunProviderDriver(
  rootPath: string,
  options: DirectorMemefastLiveRunDriverOptions = {},
): LiveRunProviderDriver {
  return {
    id: "memefast-api-live-runner",
    providerId: "memefast-api",
    capabilities: ["text", "image_generation", "video_generation", "audio_generation"],
    cancellationSupported: true,
    async prepare(input) {
      const context = resolveMemefastLiveRunContext(rootPath, input.request.providerId, options);
      return {
        providerId: context.provider.id,
        baseUrl: context.baseUrl,
        apiKeyConfigured: context.apiKey !== undefined,
        providerEnabled: context.provider.enabled,
        capabilityId: input.request.capabilityId,
      };
    },
    async start(input) {
      return startMemefastLiveRun(rootPath, input, options);
    },
    async poll(input) {
      return pollMemefastLiveRun(rootPath, input, options);
    },
    async cancel(input) {
      return cancelMemefastLiveRun(rootPath, input, options);
    },
    normalizeResult(value) {
      return isRecord(value) ? (value as LiveRunDriverStartResult | LiveRunDriverPollResult) : {};
    },
    normalizeError(error) {
      return normalizeMemefastLiveRunError(error);
    },
  };
}

export function createSpeechToTextProviderRegistry(
  plugins: readonly SpeechToTextProviderPlugin[],
): SpeechToTextProviderRegistry {
  const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  return {
    list: () => [...plugins],
    resolve: (providerId) => byId.get(providerId) ?? null,
  };
}

export function createVoiceBatchSpeechToTextProviderPlugins(): readonly SpeechToTextProviderPlugin[] {
  return [
    createStaticSpeechToTextProviderPlugin({
      id: "local-whisper-cli",
      displayName: "Local Whisper CLI",
      configured: false,
      reason: "本地 Whisper CLI 未安装或未授权启动。",
      models: ["whisper-large-v3", "whisper-medium"],
    }),
    createStaticSpeechToTextProviderPlugin({
      id: "local-faster-whisper",
      displayName: "Local faster-whisper",
      configured: false,
      reason: "本地 faster-whisper 未安装或未授权启动。",
      models: ["large-v3", "medium"],
    }),
    createStaticSpeechToTextProviderPlugin({
      id: "openai-compatible-stt",
      displayName: "OpenAI-compatible STT",
      configured: false,
      reason: "OpenAI-compatible STT 供应商未配置 API Key。",
      models: ["whisper-1", "gpt-4o-transcribe"],
    }),
    createStaticSpeechToTextProviderPlugin({
      id: "groq-stt",
      displayName: "Groq STT",
      configured: false,
      reason: "Groq STT 供应商未配置 API Key。",
      models: ["whisper-large-v3-turbo"],
    }),
    createStaticSpeechToTextProviderPlugin({
      id: "mistral-stt",
      displayName: "Mistral STT",
      configured: false,
      reason: "Mistral STT 供应商未配置 API Key。",
      models: ["voxtral-mini-latest"],
    }),
    createStaticSpeechToTextProviderPlugin({
      id: "xai-stt",
      displayName: "xAI STT",
      configured: false,
      reason: "xAI STT 供应商未配置 API Key。",
      models: ["grok-voice-stt"],
    }),
    createStaticSpeechToTextProviderPlugin({
      id: "memefast-compatible-stt",
      displayName: "MemeFast-compatible STT",
      configured: false,
      reason: "MemeFast-compatible STT 默认关闭，等待你的 API 集合供应商映射。",
      models: [],
    }),
  ];
}

export function createSpeechProviderRegistry(
  plugins: readonly SpeechProviderPlugin[],
): SpeechProviderRegistry {
  const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  return {
    list: () => [...plugins],
    resolve: (providerId) => byId.get(providerId) ?? null,
  };
}

export function createVoiceSpeechProviderPlugins(): readonly SpeechProviderPlugin[] {
  return [
    createStaticSpeechProviderPlugin({
      id: "openai-compatible-tts",
      displayName: "OpenAI-compatible TTS",
      configured: false,
      reason: "OpenAI-compatible TTS 供应商未配置 API Key。",
      models: ["tts-1", "gpt-4o-mini-tts"],
      voices: ["alloy", "verse"],
    }),
    createStaticSpeechProviderPlugin({
      id: "memefast-compatible-tts",
      displayName: "MemeFast-compatible TTS",
      configured: false,
      reason: "MemeFast-compatible TTS 默认关闭，等待你的 API 集合供应商映射。",
      models: [],
      voices: [],
    }),
    createStaticSpeechProviderPlugin({
      id: "local-cli-tts",
      displayName: "Local CLI TTS",
      configured: false,
      reason: "本地 TTS CLI 未安装或未授权启动。",
      models: [],
      voices: [],
    }),
    createStaticSpeechProviderPlugin({
      id: "piper-tts",
      displayName: "Piper TTS",
      configured: false,
      reason: "Piper TTS 未安装或未授权启动。",
      models: ["piper-local"],
      voices: [],
    }),
    createStaticSpeechProviderPlugin({
      id: "edge-compatible-tts",
      displayName: "Edge-compatible TTS",
      configured: false,
      reason: "Edge-compatible TTS 默认关闭，未配置运行条件。",
      models: ["edge-tts"],
      voices: ["zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural"],
    }),
  ];
}

export function createStaticSpeechProviderPlugin(input: {
  readonly id: string;
  readonly displayName: string;
  readonly configured: boolean;
  readonly reason?: string;
  readonly models?: readonly string[];
  readonly voices?: readonly string[];
  readonly synthesize?: SpeechProviderPlugin["synthesize"];
}): SpeechProviderPlugin {
  const models = [...(input.models ?? [])];
  const voices = [...(input.voices ?? [])];
  const sideEffects = createFailClosedSpeechProviderSideEffects();
  const reason =
    input.reason ??
    (input.configured ? "语音合成供应商已配置。" : "语音合成供应商默认关闭，未配置运行条件。");
  return {
    id: input.id,
    displayName: input.displayName,
    capabilityId: "audio.synthesize",
    sideEffects,
    isConfigured: () => input.configured,
    listModels: () => models,
    listVoices: () => voices,
    diagnose: () => ({
      ok: input.configured,
      status: input.configured ? "ready" : "blocked",
      providerId: input.id,
      reason,
      models,
      voices,
      sideEffects,
    }),
    synthesize: async (request) => {
      if (!input.configured) {
        return {
          ok: false,
          providerId: input.id,
          reason,
        };
      }
      if (input.synthesize !== undefined) {
        return input.synthesize(request);
      }
      return {
        ok: false,
        providerId: input.id,
        reason: "语音合成 provider 还没有接入真实合成实现。",
      };
    },
  };
}

export async function diagnoseSpeechProviderPlugin(
  plugin: SpeechProviderPlugin,
): Promise<SpeechProviderDiagnosis> {
  return plugin.diagnose();
}

export function createStaticSpeechToTextProviderPlugin(input: {
  readonly id: string;
  readonly displayName: string;
  readonly configured: boolean;
  readonly reason?: string;
  readonly models?: readonly string[];
  readonly transcribe?: SpeechToTextProviderPlugin["transcribe"];
}): SpeechToTextProviderPlugin {
  const models = [...(input.models ?? [])];
  const sideEffects = createFailClosedSpeechToTextSideEffects();
  const reason =
    input.reason ??
    (input.configured ? "语音转文字供应商已配置。" : "语音转文字供应商默认关闭，未配置运行条件。");
  return {
    id: input.id,
    displayName: input.displayName,
    capabilityId: "audio.transcribe",
    sideEffects,
    isConfigured: () => input.configured,
    listModels: () => models,
    diagnose: () => ({
      ok: input.configured,
      status: input.configured ? "ready" : "blocked",
      providerId: input.id,
      reason,
      models,
      sideEffects,
    }),
    transcribe: async (request) => {
      if (!input.configured) {
        return {
          ok: false,
          providerId: input.id,
          reason,
        };
      }
      if (input.transcribe !== undefined) {
        return input.transcribe(request);
      }
      return {
        ok: false,
        providerId: input.id,
        reason: "语音转文字 provider 还没有接入真实转写实现。",
      };
    },
  };
}

export async function diagnoseSpeechToTextProviderPlugin(
  plugin: SpeechToTextProviderPlugin,
): Promise<SpeechToTextProviderDiagnosis> {
  return plugin.diagnose();
}

export async function runSpeechToTextTranscription(
  registry: SpeechToTextProviderRegistry,
  input: SpeechToTextTranscriptionInput,
): Promise<SpeechToTextTranscriptionResult> {
  const sourceIssue = validateSpeechToTextAudioSource(input.source);
  if (sourceIssue !== undefined) {
    return createBlockedSpeechToTextResult(input.providerId, sourceIssue);
  }

  const plugin = registry.resolve(input.providerId);
  if (plugin === null) {
    return createBlockedSpeechToTextResult(
      input.providerId,
      `没有找到语音转文字供应商：${input.providerId}。`,
    );
  }

  const diagnosis = await plugin.diagnose();
  if (!diagnosis.ok) {
    return createBlockedSpeechToTextResult(plugin.id, diagnosis.reason);
  }

  const providerResult = await plugin.transcribe(input);
  if (!providerResult.ok) {
    return createBlockedSpeechToTextResult(
      plugin.id,
      providerResult.reason ?? "语音转文字失败，未拿到可用 transcript。",
    );
  }

  const transcript = providerResult.transcript?.trim() ?? "";
  if (transcript.length === 0) {
    return createBlockedSpeechToTextResult(plugin.id, "没有听清有效内容，未生成空 transcript。");
  }

  const model = providerResult.model ?? input.model ?? (await firstSpeechToTextModel(plugin));
  const language = providerResult.language ?? input.language;
  const durationMs = providerResult.durationMs ?? input.source.durationMs;
  const artifact = createSpeechToTextTranscriptArtifact({
    providerId: plugin.id,
    model,
    transcript,
    ...(language === undefined ? {} : { language }),
    ...(durationMs === undefined ? {} : { durationMs }),
    source: input.source,
  });
  return {
    ok: true,
    providerId: plugin.id,
    model,
    transcript,
    ...(artifact.metadata.language === undefined ? {} : { language: artifact.metadata.language }),
    ...(artifact.metadata.durationMs === undefined
      ? {}
      : { durationMs: artifact.metadata.durationMs }),
    segments: providerResult.segments ?? [
      {
        startMs: 0,
        endMs: artifact.metadata.durationMs ?? 0,
        text: transcript,
        final: true,
      },
    ],
    artifact,
    memoryWrite: false,
    sideEffects: plugin.sideEffects,
  };
}

export function createSpeechToTextTranscriptArtifact(input: {
  readonly providerId: string;
  readonly model?: string;
  readonly transcript: string;
  readonly language?: string;
  readonly durationMs?: number;
  readonly source: SpeechToTextAudioSource;
}): SpeechToTextTranscriptArtifact {
  const sourceId =
    input.source.messageId ?? input.source.sha256 ?? input.source.path ?? input.source.kind;
  return {
    id: `audio-transcript-${sanitizeId(`${input.providerId}-${sourceId}`)}`,
    kind: "text",
    capabilityId: "audio.transcribe",
    text: input.transcript,
    memoryWrite: false,
    metadata: {
      sourceKind: input.source.kind,
      providerId: input.providerId,
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.source.mimeType === undefined ? {} : { mimeType: input.source.mimeType }),
      ...(input.language === undefined ? {} : { language: input.language }),
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
      rawAudioPersisted: false,
    },
  };
}

export async function runSpeechSynthesis(
  registry: SpeechProviderRegistry,
  input: SpeechSynthesisInput,
): Promise<SpeechSynthesisResult> {
  const normalizedText = normalizeSpeechSynthesisText(input.text);
  if (normalizedText.length === 0) {
    return createBlockedSpeechSynthesisResult(input.providerId, "朗读文本为空，未启动语音合成。");
  }
  const maxTextLength = input.maxTextLength ?? 5000;
  if (normalizedText.length > maxTextLength) {
    return createBlockedSpeechSynthesisResult(
      input.providerId,
      `朗读文本太长，超过 ${maxTextLength} 字，未启动语音合成。`,
    );
  }
  const plugin = registry.resolve(input.providerId);
  if (plugin === null) {
    return createBlockedSpeechSynthesisResult(
      input.providerId,
      `没有找到语音合成供应商：${input.providerId}。`,
    );
  }
  const diagnosis = await plugin.diagnose();
  if (!diagnosis.ok) {
    return createBlockedSpeechSynthesisResult(plugin.id, diagnosis.reason);
  }
  const providerResult = await plugin.synthesize({
    ...input,
    normalizedText,
    autoplay: false,
  });
  if (!providerResult.ok || providerResult.audio === undefined) {
    return createBlockedSpeechSynthesisResult(
      plugin.id,
      providerResult.reason ?? "语音合成失败，未拿到可用 audio artifact。",
    );
  }
  const model = providerResult.model ?? input.model ?? (await firstSpeechProviderModel(plugin));
  const voice = providerResult.voice ?? input.voice ?? (await firstSpeechProviderVoice(plugin));
  const artifact = createSpeechSynthesisArtifact({
    providerId: plugin.id,
    model,
    voice,
    uri: providerResult.audio.uri,
    mimeType: providerResult.audio.mimeType,
    ...(input.format === undefined ? {} : { format: input.format }),
    ...(providerResult.audio.durationMs === undefined
      ? {}
      : { durationMs: providerResult.audio.durationMs }),
    ...(providerResult.audio.sizeBytes === undefined
      ? {}
      : { sizeBytes: providerResult.audio.sizeBytes }),
  });
  return {
    ok: true,
    providerId: plugin.id,
    model,
    voice,
    normalizedText,
    autoplay: false,
    memoryWrite: false,
    artifact,
    sideEffects: plugin.sideEffects,
  };
}

export function createSpeechSynthesisArtifact(input: {
  readonly providerId: string;
  readonly model?: string;
  readonly voice?: string;
  readonly uri: string;
  readonly mimeType: string;
  readonly format?: SpeechSynthesisFormat;
  readonly durationMs?: number;
  readonly sizeBytes?: number;
}): SpeechSynthesisArtifact {
  return {
    id: `speech-audio-${sanitizeId(`${input.providerId}-${input.uri}`)}`,
    kind: "audio",
    capabilityId: "audio.synthesize",
    uri: input.uri,
    mimeType: input.mimeType,
    memoryWrite: false,
    metadata: {
      providerId: input.providerId,
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.voice === undefined ? {} : { voice: input.voice }),
      ...(input.format === undefined ? {} : { format: input.format }),
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
      ...(input.sizeBytes === undefined ? {} : { sizeBytes: input.sizeBytes }),
      rawTextPersisted: false,
      autoplay: false,
    },
  };
}

export function planLocalWhisperTranscription(
  input: LocalWhisperTranscriptionPlanInput,
): LocalWhisperTranscriptionPlan {
  const baseSideEffects = createFailClosedSpeechToTextSideEffects();
  const executable = readNonEmptyString(input.executable);
  if (executable === undefined) {
    return createBlockedLocalWhisperPlan(input.providerId, "本地 Whisper 可执行命令为空。");
  }
  if (/[\s;&|`$<>]/u.test(executable)) {
    return createBlockedLocalWhisperPlan(
      input.providerId,
      "本地 Whisper 命令必须是单一可执行文件，不能拼 shell。",
    );
  }
  const inputPath = readNonEmptyString(input.inputPath);
  if (inputPath === undefined) {
    return createBlockedLocalWhisperPlan(input.providerId, "输入音频路径为空，未启动 Whisper。");
  }
  const outputDir = readNonEmptyString(input.outputDir);
  if (outputDir === undefined) {
    return createBlockedLocalWhisperPlan(
      input.providerId,
      "Whisper 输出目录为空，未启动 Whisper。",
    );
  }
  if (!isPathInsideRoots(inputPath, input.allowedInputRoots)) {
    return createBlockedLocalWhisperPlan(
      input.providerId,
      "输入音频路径不在授权目录内，未启动 Whisper。",
    );
  }
  if (!isPathInsideRoots(outputDir, input.allowedOutputRoots)) {
    return createBlockedLocalWhisperPlan(
      input.providerId,
      "Whisper 输出目录不在授权目录内，未启动 Whisper。",
    );
  }

  const model = input.model ?? defaultLocalWhisperModel(input.providerId);
  if (!allowedLocalWhisperModels(input.providerId).includes(model)) {
    return createBlockedLocalWhisperPlan(input.providerId, `Whisper 模型 ${model} 不在允许列表。`);
  }
  const timeoutMs = normalizeLocalWhisperTimeout(input.timeoutMs);
  const args = createLocalWhisperArgs({
    providerId: input.providerId,
    inputPath,
    outputDir,
    model,
    ...(input.language === undefined ? {} : { language: input.language }),
  });
  return {
    ok: true,
    status: "ready",
    providerId: input.providerId,
    plan: {
      command: executable,
      args,
      timeoutMs,
      networkPolicy: "none",
      stdin: false,
      shell: false,
      readableRoots: uniqueStringArray(input.allowedInputRoots),
      writableRoots: uniqueStringArray(input.allowedOutputRoots),
      metadata: {
        providerId: input.providerId,
        model,
        inputPath,
        outputDir,
        outputFormat: "json",
      },
    },
    sideEffects: baseSideEffects,
  };
}

export async function runLocalWhisperTranscription(
  input: LocalWhisperTranscriptionRunInput,
): Promise<LocalWhisperTranscriptionRunResult> {
  const planned = planLocalWhisperTranscription(input);
  if (!planned.ok) {
    return createBlockedLocalWhisperRun(input.providerId, planned.reason);
  }
  if (input.sandboxCommandRunner === undefined && input.unsafeAllowRawCommandRunner !== true) {
    return createBlockedLocalWhisperRun(
      input.providerId,
      "本地 Whisper 需要 Agent OS 沙箱执行器；未执行裸 commandRunner。",
    );
  }

  const result =
    input.sandboxCommandRunner !== undefined
      ? await input.sandboxCommandRunner({
          providerId: input.providerId,
          operationId: "audio.transcribe.local-whisper",
          plan: planned.plan,
        })
      : input.commandRunner === undefined
        ? {
            exitCode: 1,
            stdout: "",
            stderr: "本地 Whisper 需要 Agent OS 沙箱执行器；未执行裸 commandRunner。",
          }
        : await input.commandRunner(planned.plan.command, planned.plan.args, {
            timeoutMs: planned.plan.timeoutMs,
          });

  const stdoutSummary = summarizeCommandOutput(result.stdout);
  const stderrSummary = summarizeCommandOutput(result.stderr);
  const sideEffects: SpeechToTextProviderSideEffects = {
    microphoneAccessed: false,
    rawAudioPersisted: false,
    providerCredentialsUsed: false,
    networkUsed: false,
    localProcessStarted: true,
    whisperStarted: true,
  };
  if (result.exitCode !== 0) {
    return {
      ok: false,
      status: "blocked",
      providerId: input.providerId,
      reason: localWhisperErrorToChinese(result.stderr ?? result.stdout, result.exitCode),
      stdoutSummary,
      stderrSummary,
      sideEffects,
      ...(result.sandbox === undefined ? {} : { sandbox: result.sandbox }),
    };
  }

  const transcript = filterLikelyWhisperHallucinationTranscript(
    extractLocalWhisperTranscript(result.stdout),
  );
  if (transcript.length === 0) {
    return {
      ok: false,
      status: "blocked",
      providerId: input.providerId,
      reason: "Whisper 没有听清有效内容，疑似静音或幻觉文本，未生成 transcript。",
      stdoutSummary,
      stderrSummary,
      sideEffects,
      ...(result.sandbox === undefined ? {} : { sandbox: result.sandbox }),
    };
  }

  return {
    ok: true,
    status: "completed",
    providerId: input.providerId,
    transcript,
    stdoutSummary,
    stderrSummary,
    sideEffects,
    ...(result.sandbox === undefined ? {} : { sandbox: result.sandbox }),
  };
}

export function filterLikelyWhisperHallucinationTranscript(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length === 0) {
    return "";
  }
  const compact = normalized.toLowerCase().replace(/[.!?。！？，,，\s]+/gu, "");
  const hallucinations = new Set([
    "thankyou",
    "thanksforwatching",
    "subscribe",
    "subscribetoourchannel",
    "bye",
    "goodbye",
    "you",
    "嗯",
    "嗯嗯",
    "啊",
    "谢谢",
    "谢谢观看",
    "字幕由amaramorg社区提供",
  ]);
  return hallucinations.has(compact) ? "" : normalized;
}

function createFailClosedSpeechToTextSideEffects(): SpeechToTextProviderSideEffects {
  return {
    microphoneAccessed: false,
    rawAudioPersisted: false,
    providerCredentialsUsed: false,
    networkUsed: false,
    localProcessStarted: false,
    whisperStarted: false,
  };
}

function createFailClosedSpeechProviderSideEffects(): SpeechProviderSideEffects {
  return {
    speakerAccessed: false,
    providerCredentialsUsed: false,
    networkUsed: false,
    localProcessStarted: false,
    autoplayed: false,
    rawTextPersisted: false,
  };
}

function validateSpeechToTextAudioSource(source: SpeechToTextAudioSource): string | undefined {
  if (typeof source.sizeBytes === "number" && source.sizeBytes <= 0) {
    return "音频为空，未启动语音转文字。";
  }
  if (source.kind === "file-ref" && readNonEmptyString(source.path) === undefined) {
    return "音频文件路径为空，未启动语音转文字。";
  }
  if (source.kind === "weixin-voice" && readNonEmptyString(source.messageId) === undefined) {
    return "微信语音消息缺少 messageId，未启动语音转文字。";
  }
  return undefined;
}

function createBlockedSpeechToTextResult(
  providerId: string | undefined,
  reason: string,
): SpeechToTextTranscriptionBlocked {
  return {
    ok: false,
    status: "blocked",
    ...(providerId === undefined ? {} : { providerId }),
    reason,
    sideEffects: createFailClosedSpeechToTextSideEffects(),
  };
}

function createBlockedSpeechSynthesisResult(
  providerId: string | undefined,
  reason: string,
): SpeechSynthesisBlocked {
  return {
    ok: false,
    status: "blocked",
    ...(providerId === undefined ? {} : { providerId }),
    reason,
    sideEffects: createFailClosedSpeechProviderSideEffects(),
  };
}

async function firstSpeechToTextModel(plugin: SpeechToTextProviderPlugin): Promise<string> {
  const models = await plugin.listModels();
  return models[0] ?? "unknown-stt-model";
}

async function firstSpeechProviderModel(plugin: SpeechProviderPlugin): Promise<string> {
  const models = await plugin.listModels();
  return models[0] ?? "unknown-tts-model";
}

async function firstSpeechProviderVoice(plugin: SpeechProviderPlugin): Promise<string> {
  const voices = await plugin.listVoices();
  return voices[0] ?? "default";
}

async function startMemefastLiveRun(
  rootPath: string,
  input: LiveRunDriverStartInput,
  options: DirectorMemefastLiveRunDriverOptions,
): Promise<LiveRunDriverStartResult> {
  assertMemefastLiveRunStartable(rootPath, input, options);

  if (input.request.capabilityId === "text") {
    return startMemefastTextLiveRun(rootPath, input, options);
  }
  if (input.request.capabilityId === "image_generation") {
    return startMemefastMediaLiveRun(rootPath, input, options, "image");
  }
  if (input.request.capabilityId === "video_generation") {
    return startMemefastMediaLiveRun(rootPath, input, options, "video");
  }
  if (input.request.capabilityId === "audio_generation") {
    return startMemefastMediaLiveRun(rootPath, input, options, "audio");
  }

  throw createMemefastLiveRunError({
    code: "memefast-capability-unsupported",
    message: `MemeFast live runner does not support capability: ${input.request.capabilityId}.`,
    retryable: false,
  });
}

async function startMemefastTextLiveRun(
  rootPath: string,
  input: LiveRunDriverStartInput,
  options: DirectorMemefastLiveRunDriverOptions,
): Promise<LiveRunDriverStartResult> {
  const prompt = readLiveRunPrompt(input.request.input);
  const model = readLiveRunString(input.request.input.model);
  const timeoutMs = readLiveRunNumber(input.request.input.timeoutMs) ?? options.timeoutMs;
  const maxAttempts = readLiveRunNumber(input.request.input.maxAttempts) ?? options.maxTextAttempts;
  const result = await runDirectorApiProviderTextCompletion(rootPath, {
    providerId: input.request.providerId,
    prompt,
    ...(model === undefined ? {} : { model }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  if (!result.ok || !result.output) {
    throw createMemefastLiveRunError({
      code: "memefast-text-run-failed",
      message: result.message,
      retryable:
        result.status === undefined
          ? true
          : shouldRetryTextCompletionFailure(result.status, undefined),
      ...(result.status === undefined ? {} : { providerStatus: result.status }),
      ...(result.statusText === undefined ? {} : { providerStatusText: result.statusText }),
      metadata: {
        endpoint: result.endpoint,
        model: result.model,
      },
    });
  }

  return {
    completed: true,
    progress: 100,
    artifacts: [
      {
        id: `${input.request.runId}:text:0`,
        kind: "text",
        metadata: {
          model: result.model,
          text: result.output,
        },
      },
    ],
    metadata: {
      endpoint: result.endpoint,
      model: result.model,
      providerId: result.providerId,
    },
  };
}

async function startMemefastMediaLiveRun(
  rootPath: string,
  input: LiveRunDriverStartInput,
  options: DirectorMemefastLiveRunDriverOptions,
  mediaKind: "image" | "video" | "audio",
): Promise<LiveRunDriverStartResult> {
  const baseContext = resolveMemefastLiveRunContext(rootPath, input.request.providerId, options);
  const prompt = readLiveRunPrompt(input.request.input);
  const model =
    readLiveRunString(input.request.input.model) ??
    (mediaKind === "image"
      ? baseContext.provider.defaultModels.image_generation
      : mediaKind === "video"
        ? baseContext.provider.defaultModels.video_generation
        : baseContext.provider.defaultModels.audio_generation);
  const context = await resolveMemefastLiveRunContextForModel({
    rootPath,
    providerId: input.request.providerId,
    options,
    model,
  });
  const route = resolveMemefastLiveRunRoute(context, mediaKind, model);
  const endpointTypes = resolveMemefastModelEndpointTypes(context, model);
  const requestInput = await prepareMemefastMediaLiveRunInput({
    context,
    mediaKind,
    model,
    endpointTypes,
    input: input.request.input,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const requestPlan = buildDirectorMemefastGenerationRequestPlan({
    mediaKind,
    model,
    prompt,
    routeFamily: route.routeFamily,
    endpointTypes,
    input: requestInput,
  });
  const executionPolicy = resolveMemefastLiveRunExecutionPolicy(requestPlan);
  const submitUrl = toMemefastAbsoluteEndpoint(context.rootBaseUrl, requestPlan.endpointPath);
  const requestPlanPollUrl = createMemefastLiveRunPlanPollUrl(context, route, requestPlan);
  const submitBody = await buildDirectorMemefastGenerationSubmitBody(requestPlan, {
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const response = await fetchMemefastLiveRunJson(
    { ...context, timeoutMs: executionPolicy.submitTimeoutMs },
    submitUrl,
    {
      method: "POST",
      body: submitBody,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
  );
  const artifacts = extractMemefastLiveRunArtifacts(response.body, {
    kind: mediaKind,
    runId: input.request.runId,
  });
  const taskId = extractMemefastLiveRunTaskId(response.body);
  const status = extractMemefastLiveRunStatus(response.body) ?? (taskId ? "queued" : "completed");

  if (artifacts.length > 0 && !taskId) {
    return {
      completed: true,
      progress: 100,
      artifacts,
      metadata: {
        endpoint: submitUrl,
        routeFamily: route.routeFamily,
        model,
        requestPlan: summarizeDirectorGenerationRequestPlan(requestPlan),
        executionPolicy,
        ...(context.apiKeySlot === undefined ? {} : { apiKeySlot: context.apiKeySlot }),
        ...(context.apiKeyVisibility === undefined
          ? {}
          : { apiKeyVisibility: context.apiKeyVisibility }),
      },
    };
  }

  if (!taskId) {
    throw createMemefastLiveRunError({
      code: "memefast-task-id-missing",
      message: "MemeFast response did not include a task id or direct artifact.",
      retryable: true,
      metadata: {
        endpoint: submitUrl,
        routeFamily: route.routeFamily,
        model,
        requestPlan: summarizeDirectorGenerationRequestPlan(requestPlan),
        executionPolicy,
      },
    });
  }

  const pollUrl = extractMemefastLiveRunAbsoluteUrl(response.body, context.rootBaseUrl, [
    "poll_url",
    "pollUrl",
    "status_url",
    "statusUrl",
  ]);
  const cancelUrl = extractMemefastLiveRunAbsoluteUrl(response.body, context.rootBaseUrl, [
    "cancel_url",
    "cancelUrl",
  ]);
  const providerTask: LiveRunProviderTask = {
    taskId,
    status,
    pollAfterMs:
      findMemefastNumberByKeys(response.body, ["poll_after_ms", "pollAfterMs"]) ??
      executionPolicy.pollIntervalMs,
    metadata: {
      endpoint: submitUrl,
      pollUrl: pollUrl ?? requestPlanPollUrl(taskId),
      cancelUrl: cancelUrl ?? defaultMemefastLiveRunCancelUrl(context.rootBaseUrl, taskId),
      routeFamily: route.routeFamily,
      model,
      mediaKind,
      ...(route.endpointType === undefined ? {} : { endpointType: route.endpointType }),
      requestPlan: summarizeDirectorGenerationRequestPlan(requestPlan),
      executionPolicy,
      ...(context.apiKeySlot === undefined ? {} : { apiKeySlot: context.apiKeySlot }),
      ...(context.apiKeyVisibility === undefined
        ? {}
        : { apiKeyVisibility: context.apiKeyVisibility }),
    },
  };

  return {
    completed: artifacts.length > 0 && isMemefastTerminalSuccessStatus(status),
    progress:
      artifacts.length > 0 && isMemefastTerminalSuccessStatus(status)
        ? 100
        : (extractMemefastLiveRunProgress(response.body) ?? 1),
    providerTask,
    ...(artifacts.length === 0 ? {} : { artifacts }),
    metadata: {
      endpoint: submitUrl,
      routeFamily: route.routeFamily,
      model,
      mediaKind,
      requestPlan: summarizeDirectorGenerationRequestPlan(requestPlan),
      executionPolicy,
      ...(context.apiKeySlot === undefined ? {} : { apiKeySlot: context.apiKeySlot }),
      ...(context.apiKeyVisibility === undefined
        ? {}
        : { apiKeyVisibility: context.apiKeyVisibility }),
    },
  };
}

async function prepareMemefastMediaLiveRunInput(input: {
  readonly context: MemefastLiveRunContext;
  readonly mediaKind: "image" | "video" | "audio";
  readonly model: string;
  readonly endpointTypes: readonly string[];
  readonly input: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}): Promise<Readonly<Record<string, unknown>>> {
  if (
    input.mediaKind !== "video" ||
    !/pixverse/iu.test(input.model) ||
    input.context.apiKey === undefined
  ) {
    return input.input;
  }

  const firstFrame = readLiveRunFirstFrame(input.input);
  const lastFrame = readLiveRunLastFrame(input.input);
  const referenceImages = readLiveRunReferenceImages(input.input);
  if (firstFrame === undefined && lastFrame === undefined && referenceImages.length === 0) {
    return input.input;
  }

  const existingImageIds = isRecord(input.input.pixverseImageIds)
    ? input.input.pixverseImageIds
    : {};
  const nextImageIds: Record<string, unknown> = { ...existingImageIds };
  if (firstFrame !== undefined && readLiveRunImageId(nextImageIds.firstFrame) === undefined) {
    nextImageIds.firstFrame = await uploadMemefastPixVerseImage({
      context: input.context,
      imageUrl: firstFrame,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  }
  if (lastFrame !== undefined && readLiveRunImageId(nextImageIds.lastFrame) === undefined) {
    nextImageIds.lastFrame = await uploadMemefastPixVerseImage({
      context: input.context,
      imageUrl: lastFrame,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  }
  const existingReferences = readLiveRunImageIdArray(nextImageIds.references);
  if (referenceImages.length > 0 && existingReferences.length < referenceImages.length) {
    const uploadedReferences = [...existingReferences];
    for (const [index, imageUrl] of referenceImages.slice(existingReferences.length).entries()) {
      uploadedReferences.push(
        await uploadMemefastPixVerseImage({
          context: input.context,
          imageUrl,
          filename: `pixverse_ref_${existingReferences.length + index + 1}.png`,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        }),
      );
    }
    nextImageIds.references = uploadedReferences;
  }

  return {
    ...input.input,
    pixverseImageIds: nextImageIds,
  };
}

async function uploadMemefastPixVerseImage(input: {
  readonly context: MemefastLiveRunContext;
  readonly imageUrl: string;
  readonly filename?: string;
  readonly signal?: AbortSignal;
}): Promise<number | string> {
  if (typeof input.context.fetchImpl !== "function") {
    throw createMemefastLiveRunError({
      code: "memefast-fetch-missing",
      message: "No fetch implementation is available for PixVerse image upload.",
      retryable: true,
    });
  }
  if (input.context.apiKey === undefined) {
    throw createMemefastLiveRunError({
      code: "memefast-api-key-missing",
      message: "No MemeFast API key is configured for PixVerse image upload.",
      retryable: false,
    });
  }

  const formData = new FormData();
  formData.append("image_url", input.imageUrl);
  if (input.filename !== undefined) {
    formData.append("filename", input.filename);
  }
  const uploadUrl = toMemefastAbsoluteEndpoint(
    input.context.rootBaseUrl,
    "/openapi/v2/image/upload",
  );
  const response = await input.context.fetchImpl(uploadUrl, {
    method: "POST",
    headers: createPixVerseLiveRunHeaders(input.context.apiKey, false),
    body: formData,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const text = await response.text();
  const body = parseJsonOrText(text);
  if (!response.ok) {
    throw createMemefastLiveRunError({
      code: "memefast-pixverse-upload-failed",
      message:
        extractMemefastLiveRunMessage(body) ??
        `PixVerse image upload failed: HTTP ${response.status} ${response.statusText || ""}`.trim(),
      retryable:
        response.status === 408 ||
        response.status === 409 ||
        response.status === 429 ||
        response.status >= 500,
      providerStatus: response.status,
      providerStatusText: response.statusText,
      metadata: { endpoint: uploadUrl },
    });
  }
  return extractMemefastPixVerseImageId(body);
}

function extractMemefastPixVerseImageId(value: unknown): number | string {
  for (const entry of iterateMemefastRecords(value)) {
    for (const key of ["img_id", "imgId", "id"]) {
      const candidate = entry[key];
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return candidate;
      }
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
  }
  throw createMemefastLiveRunError({
    code: "memefast-pixverse-upload-id-missing",
    message: "PixVerse image upload did not return an image id.",
    retryable: true,
  });
}

async function pollMemefastLiveRun(
  rootPath: string,
  input: LiveRunDriverPollInput,
  options: DirectorMemefastLiveRunDriverOptions,
): Promise<LiveRunDriverPollResult> {
  const apiKeySlot = readLiveRunNumber(input.providerTask.metadata?.apiKeySlot);
  const context = resolveMemefastLiveRunContext(rootPath, input.request.providerId, {
    ...options,
    ...(apiKeySlot === undefined ? {} : { apiKeySlot }),
  });
  const executionPolicy = isRecord(input.providerTask.metadata?.executionPolicy)
    ? input.providerTask.metadata.executionPolicy
    : undefined;
  const pollRequestTimeoutMs = readLiveRunNumber(executionPolicy?.pollRequestTimeoutMs);
  const pollMaxAttempts = readLiveRunNumber(executionPolicy?.pollMaxAttempts);
  const currentPollAttempt = readLiveRunNumber(input.providerTask.metadata?.pollAttempt) ?? 0;
  const nextPollAttempt = currentPollAttempt + 1;
  const model =
    readLiveRunString(input.request.input.model) ??
    readLiveRunString(input.providerTask.metadata?.model);
  const mediaKind =
    input.request.capabilityId === "audio_generation" ||
    input.providerTask.metadata?.mediaKind === "audio"
      ? "audio"
      : input.request.capabilityId === "image_generation" ||
          input.providerTask.metadata?.mediaKind === "image"
        ? "image"
        : "video";
  const route =
    model === undefined ? undefined : resolveMemefastLiveRunRoute(context, mediaKind, model);
  const pollUrl =
    readLiveRunString(input.providerTask.metadata?.pollUrl) ??
    (route === undefined ? undefined : route.pollUrl(input.providerTask.taskId)) ??
    `${context.rootBaseUrl}/v1/tasks/${encodeURIComponent(input.providerTask.taskId)}`;
  if (pollMaxAttempts !== undefined && nextPollAttempt > pollMaxAttempts) {
    const providerTask: LiveRunProviderTask = {
      ...input.providerTask,
      status: input.providerTask.status ?? "polling",
      metadata: {
        ...(input.providerTask.metadata ?? {}),
        pollUrl,
        pollAttempt: nextPollAttempt,
      },
    };
    return {
      completed: false,
      failed: true,
      progress: input.session.progress ?? 0,
      providerTask,
      error: createMemefastLiveRunError({
        code: "memefast-task-poll-timeout",
        message: `MemeFast task polling exceeded ${pollMaxAttempts} attempt(s).`,
        retryable: false,
        metadata: {
          pollUrl,
          pollAttempt: nextPollAttempt,
          pollMaxAttempts,
        },
      }),
      metadata: {
        endpoint: pollUrl,
        pollAttempt: nextPollAttempt,
        pollMaxAttempts,
      },
    };
  }
  const response = await fetchMemefastLiveRunJson(
    pollRequestTimeoutMs === undefined ? context : { ...context, timeoutMs: pollRequestTimeoutMs },
    pollUrl,
    {
      method: "GET",
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
  );
  const status =
    extractMemefastLiveRunStatus(response.body) ?? input.providerTask.status ?? "polling";
  const progress = extractMemefastLiveRunProgress(response.body);
  let artifacts = extractMemefastLiveRunArtifacts(response.body, {
    kind: mediaKind,
    runId: input.request.runId,
  });
  const providerTask: LiveRunProviderTask = {
    ...input.providerTask,
    status,
    metadata: {
      ...(input.providerTask.metadata ?? {}),
      pollUrl,
      pollAttempt: nextPollAttempt,
      lastPollStatus: response.status,
    },
  };

  if (isMemefastTerminalFailureStatus(status)) {
    return {
      failed: true,
      completed: false,
      progress: progress ?? input.session.progress ?? 0,
      providerTask,
      error: createMemefastLiveRunError({
        code: "memefast-task-failed",
        message: extractMemefastLiveRunMessage(response.body) ?? `MemeFast task failed: ${status}.`,
        retryable: false,
        metadata: {
          pollUrl,
          status,
        },
      }),
      metadata: {
        endpoint: pollUrl,
        status,
      },
    };
  }

  if (mediaKind === "video" && artifacts.length === 0) {
    artifacts = await retrieveMemefastMiniMaxArtifacts({
      context,
      responseBody: response.body,
      runId: input.request.runId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(pollRequestTimeoutMs === undefined ? {} : { timeoutMs: pollRequestTimeoutMs }),
    });
  }

  if (isMemefastTerminalSuccessStatus(status) || artifacts.length > 0) {
    return {
      completed: true,
      failed: false,
      progress: 100,
      providerTask,
      artifacts,
      metadata: {
        endpoint: pollUrl,
        status,
      },
    };
  }

  return {
    completed: false,
    failed: false,
    progress: progress ?? input.session.progress ?? 1,
    providerTask,
    metadata: {
      endpoint: pollUrl,
      status,
    },
  };
}

async function retrieveMemefastMiniMaxArtifacts(input: {
  readonly context: MemefastLiveRunContext;
  readonly responseBody: unknown;
  readonly runId: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}): Promise<LiveRunArtifact[]> {
  const fileId = findMemefastStringByKeys(input.responseBody, ["file_id", "fileId"]);
  if (fileId === undefined) {
    return [];
  }
  const retrieveUrl = toMemefastAbsoluteEndpoint(
    input.context.rootBaseUrl,
    `/minimax/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`,
  );
  const response = await fetchMemefastLiveRunJson(
    input.timeoutMs === undefined
      ? input.context
      : { ...input.context, timeoutMs: input.timeoutMs },
    retrieveUrl,
    {
      method: "GET",
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
  );
  return extractMemefastLiveRunArtifacts(response.body, {
    kind: "video",
    runId: input.runId,
  });
}

async function cancelMemefastLiveRun(
  rootPath: string,
  input: LiveRunDriverCancelInput,
  options: DirectorMemefastLiveRunDriverOptions,
): Promise<LiveRunDriverCancelResult> {
  const providerTask = input.session.providerTask;
  const apiKeySlot = readLiveRunNumber(providerTask?.metadata?.apiKeySlot);
  const context = resolveMemefastLiveRunContext(rootPath, input.request.providerId, {
    ...options,
    ...(apiKeySlot === undefined ? {} : { apiKeySlot }),
  });
  if (providerTask === undefined) {
    return {
      cancelled: true,
      metadata: {
        skipped: "provider-task-missing",
      },
    };
  }

  const cancelUrl =
    readLiveRunString(input.cancelToken.metadata?.cancelUrl) ??
    readLiveRunString(providerTask.metadata?.cancelUrl) ??
    defaultMemefastLiveRunCancelUrl(context.rootBaseUrl, providerTask.taskId);
  const response = await fetchMemefastLiveRunJson(context, cancelUrl, {
    method: "POST",
    body: {
      reason: input.cancelToken.reason,
      runId: input.cancelToken.runId,
      sessionId: input.cancelToken.sessionId,
    },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const status = extractMemefastLiveRunStatus(response.body) ?? "cancelled";
  return {
    cancelled: response.ok,
    providerTask: {
      ...providerTask,
      status,
      metadata: {
        ...(providerTask.metadata ?? {}),
        cancelUrl,
        cancelStatus: response.status,
      },
    },
    metadata: {
      endpoint: cancelUrl,
      status,
    },
  };
}

interface MemefastLiveRunContext {
  readonly provider: DirectorApiProviderAdapter;
  readonly stored?: StoredDirectorApiProvider;
  readonly baseUrl: string;
  readonly rootBaseUrl: string;
  readonly apiKey?: string;
  readonly apiKeySlot?: number;
  readonly apiKeyVisibility?: DirectorApiProviderModelVisibilityStatus;
  readonly fetchImpl?: DirectorApiProviderFetch;
  readonly timeoutMs: number;
}

interface MemefastLiveRunRoute {
  readonly submitUrl: string;
  readonly pollUrl: (taskId: string) => string;
  readonly routeFamily: string;
  readonly endpointType?: string;
}

interface MemefastLiveRunExecutionPolicy {
  readonly submitTimeoutMs: number;
  readonly pollRequestTimeoutMs: number;
  readonly pollIntervalMs: number;
  readonly pollMaxAttempts: number;
  readonly pollMaxDurationMs: number;
}

const MEMEFAST_LIVE_RUN_UNIFIED_VIDEO_ENDPOINT_PATHS: Readonly<
  Record<string, { readonly submit: string; readonly poll: (taskId: string) => string }>
> = {
  grok视频: { submit: "/v1/video/create", poll: (taskId) => `/v1/video/query?id=${taskId}` },
  视频统一格式: { submit: "/v1/video/create", poll: (taskId) => `/v1/video/query?id=${taskId}` },
  海螺视频生成: {
    submit: "/minimax/v1/video_generation",
    poll: (taskId) => `/minimax/v1/query/video_generation?task_id=${taskId}`,
  },
  luma视频生成: { submit: "/luma/generations", poll: (taskId) => `/luma/generations/${taskId}` },
  luma视频扩展: { submit: "/luma/generations", poll: (taskId) => `/luma/generations/${taskId}` },
  luma视频延长: { submit: "/luma/generations", poll: (taskId) => `/luma/generations/${taskId}` },
  runway图生视频: {
    submit: "/runwayml/v1/image_to_video",
    poll: (taskId) => `/runwayml/v1/tasks/${taskId}`,
  },
  wan视频生成: {
    submit: "/alibailian/api/v1/services/aigc/video-generation/video-synthesis",
    poll: (taskId) => `/alibailian/api/v1/tasks/${taskId}`,
  },
  "aigc-video": {
    submit: "/tencent-vod/v1/aigc-video",
    poll: (taskId) => `/tencent-vod/v1/query/${taskId}`,
  },
  vidu文生视频: {
    submit: "/ent/v2/text2video",
    poll: (taskId) => `/ent/v2/tasks/${taskId}/creations`,
  },
  vidu图生视频: {
    submit: "/ent/v2/img2video",
    poll: (taskId) => `/ent/v2/tasks/${taskId}/creations`,
  },
  vidu参考生视频: {
    submit: "/ent/v2/reference2video",
    poll: (taskId) => `/ent/v2/tasks/${taskId}/creations`,
  },
  vidu首尾帧: {
    submit: "/ent/v2/start-end2video",
    poll: (taskId) => `/ent/v2/tasks/${taskId}/creations`,
  },
};

const MEMEFAST_LIVE_RUN_IMAGE_ENDPOINT_PATHS: Readonly<
  Record<string, { readonly submit: string; readonly poll: (taskId: string) => string }>
> = {
  "aigc-image": {
    submit: "/tencent-vod/v1/aigc-image",
    poll: (taskId) => `/tencent-vod/v1/aigc-image/${taskId}`,
  },
  vidu生图: {
    submit: "/ent/v2/reference2image",
    poll: (taskId) => `/ent/v2/tasks/${taskId}/creations`,
  },
};

const MEMEFAST_TERMINAL_SUCCESS_STATUSES = new Set([
  "success",
  "succeeded",
  "completed",
  "complete",
  "done",
  "finished",
  "video_generation_completed",
  "image_generation_completed",
  "audio_generation_completed",
]);

const MEMEFAST_TERMINAL_FAILURE_STATUSES = new Set([
  "failed",
  "failure",
  "error",
  "aborted",
  "cancelled",
  "canceled",
  "rejected",
  "expired",
  "video_generation_failed",
  "image_generation_failed",
  "audio_generation_failed",
]);

function resolveMemefastLiveRunContext(
  rootPath: string,
  providerId: string,
  options: DirectorMemefastLiveRunDriverOptions,
): MemefastLiveRunContext {
  const storedProviders = ensureStoredProviders(loadStoredDocument(rootPath).providers);
  const providers = buildProviderAdapters(storedProviders);
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) {
    throw createMemefastLiveRunError({
      code: "memefast-provider-unknown",
      message: `Unknown API provider: ${providerId}.`,
      retryable: false,
    });
  }

  const stored = storedProviders.find((item) => item.id === provider.id);
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const fetchImpl =
    options.fetchImpl ?? (globalThis.fetch as unknown as DirectorApiProviderFetch | undefined);
  const apiKeys = resolveApiKeys(stored?.apiKey, process.env[provider.apiKeyEnvVar]);
  const requestedSlot =
    options.apiKeySlot !== undefined && Number.isFinite(options.apiKeySlot)
      ? Math.max(0, Math.trunc(options.apiKeySlot))
      : 0;
  const apiKey = apiKeys[requestedSlot] ?? apiKeys[0];
  const apiKeySlot = apiKey === undefined ? undefined : apiKeys.indexOf(apiKey);
  return {
    provider,
    ...(stored === undefined ? {} : { stored }),
    baseUrl,
    rootBaseUrl: normalizeProviderRootBaseUrl(baseUrl),
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(apiKeySlot === undefined ? {} : { apiKeySlot }),
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
    timeoutMs: options.timeoutMs ?? 120_000,
  };
}

async function resolveMemefastLiveRunContextForModel(input: {
  readonly rootPath: string;
  readonly providerId: string;
  readonly options: DirectorMemefastLiveRunDriverOptions;
  readonly model: string;
}): Promise<MemefastLiveRunContext> {
  const context = resolveMemefastLiveRunContext(input.rootPath, input.providerId, input.options);
  if (
    context.provider.platform !== "memefast" ||
    context.stored === undefined ||
    typeof context.fetchImpl !== "function"
  ) {
    return context;
  }
  const apiKeys = resolveApiKeys(context.stored.apiKey, process.env[context.provider.apiKeyEnvVar]);
  const plannedKeys = await planDirectorApiProviderKeysForModel({
    provider: context.provider,
    stored: context.stored,
    model: input.model,
    apiKeys,
    timeoutMs: context.timeoutMs,
    fetchImpl: context.fetchImpl,
  });
  const plannedKey = plannedKeys[0];
  if (plannedKey === undefined) {
    return context;
  }
  const apiKeySlot = apiKeys.indexOf(plannedKey.apiKey);
  return {
    ...context,
    apiKey: plannedKey.apiKey,
    apiKeySlot: apiKeySlot < 0 ? plannedKey.originalIndex : apiKeySlot,
    apiKeyVisibility: plannedKey.routingHint.visibility,
  };
}

function assertMemefastLiveRunStartable(
  rootPath: string,
  input: LiveRunDriverStartInput,
  options: DirectorMemefastLiveRunDriverOptions,
): void {
  const context = resolveMemefastLiveRunContext(rootPath, input.request.providerId, options);
  if (!context.provider.enabled) {
    throw createMemefastLiveRunError({
      code: "memefast-provider-disabled",
      message: "MemeFast provider is disabled.",
      retryable: false,
    });
  }
  if (
    !context.provider.capabilities.includes(
      input.request.capabilityId as DirectorApiProviderCapability,
    )
  ) {
    throw createMemefastLiveRunError({
      code: "memefast-capability-unsupported",
      message: `MemeFast provider does not expose capability: ${input.request.capabilityId}.`,
      retryable: false,
    });
  }
  if (!context.apiKey) {
    throw createMemefastLiveRunError({
      code: "memefast-api-key-missing",
      message: "No MemeFast API key is configured.",
      retryable: false,
    });
  }
  if (typeof context.fetchImpl !== "function") {
    throw createMemefastLiveRunError({
      code: "memefast-fetch-missing",
      message: "No fetch implementation is available for MemeFast live runner.",
      retryable: true,
    });
  }
}

function resolveMemefastLiveRunRoute(
  context: MemefastLiveRunContext,
  mediaKind: "image" | "video" | "audio",
  model: string,
): MemefastLiveRunRoute {
  const metadata = context.provider.modelMetadata.find((item) => item.model === model);
  const endpointTypes = resolveMemefastModelEndpointTypes(context, model);
  if (mediaKind === "audio") {
    const isLyrics =
      /lyrics|歌词/iu.test(model) || endpointTypes.some((type) => /lyrics|歌词/iu.test(type));
    return {
      submitUrl: toMemefastAbsoluteEndpoint(
        context.rootBaseUrl,
        isLyrics ? "/suno/submit/lyrics" : "/suno/submit/music",
      ),
      pollUrl: (taskId) =>
        toMemefastAbsoluteEndpoint(
          context.rootBaseUrl,
          `/suno/fetch/${encodeURIComponent(taskId)}`,
        ),
      routeFamily: "suno",
      ...(endpointTypes[0] === undefined ? {} : { endpointType: endpointTypes[0] }),
    };
  }
  if (mediaKind === "image") {
    const endpointType = endpointTypes.find((type) => MEMEFAST_LIVE_RUN_IMAGE_ENDPOINT_PATHS[type]);
    const paths =
      endpointType === undefined
        ? {
            submit: "/v1/images/generations",
            poll: (taskId: string) => `/v1/images/generations/${taskId}`,
          }
        : (MEMEFAST_LIVE_RUN_IMAGE_ENDPOINT_PATHS[endpointType] ?? {
            submit: "/v1/images/generations",
            poll: (taskId: string) => `/v1/images/generations/${taskId}`,
          });
    return {
      submitUrl: toMemefastAbsoluteEndpoint(context.rootBaseUrl, paths.submit),
      pollUrl: (taskId) => toMemefastAbsoluteEndpoint(context.rootBaseUrl, paths.poll(taskId)),
      routeFamily:
        metadata?.imageRouteFamily ??
        resolveDirectorApiProviderImageRouteFamily(endpointTypes, model),
      ...(endpointType === undefined ? {} : { endpointType }),
    };
  }

  const routeFamily =
    metadata?.videoRouteFamily ?? resolveDirectorApiProviderVideoRouteFamily(endpointTypes, model);
  if (routeFamily === "openai_official") {
    return {
      submitUrl: toMemefastAbsoluteEndpoint(context.rootBaseUrl, "/v1/videos"),
      pollUrl: (taskId) => toMemefastAbsoluteEndpoint(context.rootBaseUrl, `/v1/videos/${taskId}`),
      routeFamily,
      ...(endpointTypes[0] === undefined ? {} : { endpointType: endpointTypes[0] }),
    };
  }
  if (routeFamily === "volc") {
    const submitUrl = resolveMemefastSeedanceTaskSubmitUrl(context.baseUrl);
    return {
      submitUrl,
      pollUrl: (taskId) => `${submitUrl}/${encodeURIComponent(taskId)}`,
      routeFamily,
      ...(endpointTypes[0] === undefined ? {} : { endpointType: endpointTypes[0] }),
    };
  }
  if (routeFamily === "happyhorse" || routeFamily === "wan") {
    return {
      submitUrl: toMemefastAbsoluteEndpoint(
        context.rootBaseUrl,
        "/alibailian/api/v1/services/aigc/video-generation/video-synthesis",
      ),
      pollUrl: (taskId) =>
        toMemefastAbsoluteEndpoint(context.rootBaseUrl, `/alibailian/api/v1/tasks/${taskId}`),
      routeFamily,
      ...(endpointTypes[0] === undefined ? {} : { endpointType: endpointTypes[0] }),
    };
  }
  if (routeFamily === "kling") {
    const operation = readKlingVideoOperation(model, endpointTypes);
    return {
      submitUrl: toMemefastAbsoluteEndpoint(context.rootBaseUrl, `/kling/v1/videos/${operation}`),
      pollUrl: (taskId) =>
        toMemefastAbsoluteEndpoint(context.rootBaseUrl, `/kling/v1/videos/${operation}/${taskId}`),
      routeFamily,
      ...(endpointTypes[0] === undefined ? {} : { endpointType: endpointTypes[0] }),
    };
  }
  if (routeFamily === "replicate") {
    return {
      submitUrl: toMemefastAbsoluteEndpoint(context.rootBaseUrl, "/replicate/v1/predictions"),
      pollUrl: (taskId) =>
        toMemefastAbsoluteEndpoint(context.rootBaseUrl, `/replicate/v1/predictions/${taskId}`),
      routeFamily,
      ...(endpointTypes[0] === undefined ? {} : { endpointType: endpointTypes[0] }),
    };
  }

  const endpointType = endpointTypes.find(
    (type) => MEMEFAST_LIVE_RUN_UNIFIED_VIDEO_ENDPOINT_PATHS[type],
  );
  const paths =
    endpointType === undefined
      ? {
          submit: "/v1/video/generations",
          poll: (taskId: string) => `/v1/video/generations/${taskId}`,
        }
      : (MEMEFAST_LIVE_RUN_UNIFIED_VIDEO_ENDPOINT_PATHS[endpointType] ?? {
          submit: "/v1/video/generations",
          poll: (taskId: string) => `/v1/video/generations/${taskId}`,
        });
  return {
    submitUrl: toMemefastAbsoluteEndpoint(context.rootBaseUrl, paths.submit),
    pollUrl: (taskId) => toMemefastAbsoluteEndpoint(context.rootBaseUrl, paths.poll(taskId)),
    routeFamily,
    ...(endpointType === undefined ? {} : { endpointType }),
  };
}

function resolveMemefastModelEndpointTypes(
  context: Pick<MemefastLiveRunContext, "provider">,
  model: string,
): readonly string[] {
  return resolveDirectorApiProviderModelEndpointTypes(context.provider, model);
}

function resolveDirectorApiProviderModelEndpointTypes(
  provider: Pick<DirectorApiProviderAdapter, "modelMetadata">,
  model: string,
): readonly string[] {
  return (
    provider.modelMetadata.find((item) => item.model === model)?.endpointTypes ??
    MEMEFAST_MODEL_ENDPOINT_TYPES[model] ??
    []
  );
}

function resolveMemefastLiveRunExecutionPolicy(
  requestPlan: DirectorGenerationRequestPlan,
): MemefastLiveRunExecutionPolicy {
  const pollRequestTimeoutMs = 30_000;
  const submitTimeoutMs =
    requestPlan.mediaType === "text"
      ? DIRECTOR_TEXT_GENERATION_SUBMIT_TIMEOUT_MS
      : DIRECTOR_MEDIA_GENERATION_SUBMIT_TIMEOUT_MS;
  if (requestPlan.mediaType === "video") {
    return {
      submitTimeoutMs,
      pollRequestTimeoutMs,
      pollIntervalMs: 5_000,
      pollMaxAttempts: 180,
      pollMaxDurationMs: 5_000 * 180,
    };
  }
  if (requestPlan.mediaType === "audio") {
    return {
      submitTimeoutMs,
      pollRequestTimeoutMs,
      pollIntervalMs: 3_000,
      pollMaxAttempts: 120,
      pollMaxDurationMs: 3_000 * 120,
    };
  }
  return {
    submitTimeoutMs,
    pollRequestTimeoutMs,
    pollIntervalMs: 2_000,
    pollMaxAttempts: 120,
    pollMaxDurationMs: 2_000 * 120,
  };
}

function createMemefastLiveRunPlanPollUrl(
  context: MemefastLiveRunContext,
  route: MemefastLiveRunRoute,
  requestPlan: DirectorGenerationRequestPlan,
): (taskId: string) => string {
  if (requestPlan.family === "suno") {
    return (taskId) =>
      toMemefastAbsoluteEndpoint(context.rootBaseUrl, `/suno/fetch/${encodeURIComponent(taskId)}`);
  }
  if (requestPlan.family === "pixverse") {
    return (taskId) =>
      toMemefastAbsoluteEndpoint(
        context.rootBaseUrl,
        `/openapi/v2/video/result/${encodeURIComponent(taskId)}`,
      );
  }
  if (requestPlan.family === "kling" && requestPlan.endpointPath.startsWith("/kling/v1/videos/")) {
    return (taskId) =>
      toMemefastAbsoluteEndpoint(
        context.rootBaseUrl,
        `${requestPlan.endpointPath}/${encodeURIComponent(taskId)}`,
      );
  }
  return route.pollUrl;
}

async function buildDirectorMemefastGenerationSubmitBody(
  requestPlan: DirectorGenerationRequestPlan,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Readonly<Record<string, unknown>> | FormData> {
  if (requestPlan.endpointPath === "/v1/images/edits" && requestPlan.family === "gpt_image") {
    return buildDirectorMemefastGptImageEditFormData(requestPlan, options);
  }
  if (requestPlan.endpointPath === "/v1/videos") {
    return buildDirectorMemefastOfficialVideoFormData(requestPlan, options);
  }
  return normalizeDirectorMemefastJsonImageReferences(requestPlan.body, options);
}

function createDirectorMemefastGenerationSubmitHeaders(
  apiKey: string,
  body: Readonly<Record<string, unknown>> | FormData,
): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
  };
}

async function buildDirectorMemefastGptImageEditFormData(
  requestPlan: DirectorGenerationRequestPlan,
  options: { readonly signal?: AbortSignal },
): Promise<FormData> {
  const formData = new FormData();
  appendDirectorMemefastMultipartFields(formData, requestPlan.body, ["images", "mask"]);

  const references = extractDirectorMemefastImageReferences(requestPlan.body.images);
  if (references.length === 0) {
    throw new Error("GPT Image edit requests require at least one reference image upload.");
  }
  for (const [index, reference] of references.slice(0, 16).entries()) {
    const file = await directorMemefastImageReferenceToBlob(reference, {
      filenamePrefix: "gpt-image-ref",
      index,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    formData.append("image", file.blob, file.filename);
  }

  const mask = readLiveRunString(requestPlan.body.mask);
  if (mask !== undefined) {
    const file = await directorMemefastImageReferenceToBlob(mask, {
      filenamePrefix: "gpt-image-mask",
      index: 0,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    formData.append("mask", file.blob, file.filename);
  }

  return formData;
}

async function buildDirectorMemefastOfficialVideoFormData(
  requestPlan: DirectorGenerationRequestPlan,
  options: { readonly signal?: AbortSignal },
): Promise<FormData> {
  const formData = new FormData();
  appendDirectorMemefastMultipartFields(formData, requestPlan.body, [
    "input_reference",
    "input_references",
  ]);

  const references = uniqueStringArray([
    ...extractDirectorMemefastImageReferences(requestPlan.body.input_reference),
    ...extractDirectorMemefastImageReferences(requestPlan.body.input_references),
  ]);
  for (const [index, reference] of references.entries()) {
    const file = await directorMemefastImageReferenceToBlob(reference, {
      filenamePrefix: requestPlan.family === "veo" ? "veo-reference" : "sora-reference",
      index,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    formData.append("input_reference", file.blob, file.filename);
  }

  return formData;
}

async function normalizeDirectorMemefastJsonImageReferences(
  body: Readonly<Record<string, unknown>>,
  options: { readonly signal?: AbortSignal },
): Promise<Readonly<Record<string, unknown>>> {
  return normalizeDirectorMemefastJsonImageReferenceValue(body, [], options).then((value) =>
    isRecord(value) ? value : body,
  );
}

async function normalizeDirectorMemefastJsonImageReferenceValue(
  value: unknown,
  path: readonly string[],
  options: { readonly signal?: AbortSignal },
): Promise<unknown> {
  if (typeof value === "string") {
    return shouldHostDirectorMemefastImageReference(path, value)
      ? uploadDirectorMemefastImageProxyReference(value, options)
      : value;
  }
  if (Array.isArray(value)) {
    return Promise.all(
      value.map((item) => normalizeDirectorMemefastJsonImageReferenceValue(item, path, options)),
    );
  }
  if (!isRecord(value)) {
    return value;
  }
  const entries = await Promise.all(
    Object.entries(value).map(async ([key, entry]) => [
      key,
      await normalizeDirectorMemefastJsonImageReferenceValue(entry, [...path, key], options),
    ]),
  );
  return Object.fromEntries(entries);
}

function shouldHostDirectorMemefastImageReference(path: readonly string[], value: string): boolean {
  if (!needsDirectorMemefastImageProxy(value)) {
    return false;
  }
  const lastKey = path.at(-1);
  if (lastKey && DIRECTOR_MEMEFAST_IMAGE_REFERENCE_KEYS.has(lastKey)) {
    return true;
  }
  return (
    lastKey === "url" &&
    path.some((key) => key === "image_url" || key === "imageUrl" || key === "image")
  );
}

function needsDirectorMemefastImageProxy(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }
  if (/^https?:\/\//iu.test(normalized)) {
    return hasDirectorUnsafeHostedImageFormat(normalized);
  }
  return (
    /^data:/iu.test(normalized) ||
    /^file:/iu.test(normalized) ||
    /^local-image:\/\//iu.test(normalized) ||
    isAbsolute(normalized) ||
    normalizeDirectorMemefastRawBase64(normalized) !== undefined
  );
}

function hasDirectorUnsafeHostedImageFormat(value: string): boolean {
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname.toLowerCase();
    const format = (
      parsed.searchParams.get("format") ??
      parsed.searchParams.get("outputFormat") ??
      parsed.searchParams.get("outputformat") ??
      ""
    ).toLowerCase();
    return (
      pathname.endsWith(".webp") ||
      pathname.endsWith(".avif") ||
      pathname.endsWith(".gif") ||
      ["webp", "webp_animated", "avif", "gif", "auto"].includes(format)
    );
  } catch {
    const normalized = value.toLowerCase();
    return (
      normalized.includes(".webp") ||
      normalized.includes(".avif") ||
      normalized.includes(".gif") ||
      normalized.includes("format=webp") ||
      normalized.includes("outputformat=webp") ||
      normalized.includes("format=avif") ||
      normalized.includes("outputformat=avif") ||
      normalized.includes("format=gif") ||
      normalized.includes("outputformat=auto")
    );
  }
}

async function uploadDirectorMemefastImageProxyReference(
  reference: string,
  options: { readonly signal?: AbortSignal },
): Promise<string> {
  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation is available for zhongzhuan ImageProxy upload.");
  }
  const upload = await directorMemefastImageReferenceToBlob(reference, {
    filenamePrefix: "zhongzhuan-reference",
    index: 0,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const formData = new FormData();
  formData.append("file", upload.blob, upload.filename);
  const response = await fetchImpl(DIRECTOR_MEMEFAST_IMAGE_PROXY_UPLOAD_URL, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    },
    body: formData,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const text = await response.text();
  const body = parseJsonOrText(text);
  if (!response.ok) {
    throw new Error(
      extractMemefastLiveRunMessage(body) ??
        `zhongzhuan ImageProxy upload failed: HTTP ${response.status} ${
          response.statusText || ""
        }`.trim(),
    );
  }
  const url =
    findMemefastStringByKeys(body, ["url", "image_url", "imageUrl", "src"]) ??
    extractFirstDirectorHttpUrl(text);
  if (url === undefined) {
    throw new Error("zhongzhuan ImageProxy upload succeeded but returned no URL.");
  }
  return url;
}

function extractFirstDirectorHttpUrl(value: string): string | undefined {
  return value.match(/https?:\/\/[^\s"'<>]+/iu)?.[0];
}

function appendDirectorMemefastMultipartFields(
  formData: FormData,
  body: Readonly<Record<string, unknown>>,
  skippedKeys: readonly string[],
): void {
  const skipped = new Set(skippedKeys);
  for (const [key, value] of Object.entries(body)) {
    if (skipped.has(key) || value === undefined || value === null) {
      continue;
    }
    formData.append(key, stringifyDirectorMemefastMultipartField(value));
  }
}

function stringifyDirectorMemefastMultipartField(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
}

function extractDirectorMemefastImageReferences(value: unknown): string[] {
  if (typeof value === "string" && value.trim().length > 0) {
    return [value.trim()];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const references: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) {
      references.push(item.trim());
      continue;
    }
    if (!isRecord(item)) {
      continue;
    }
    const imageUrl =
      readLiveRunString(item.image_url) ??
      readLiveRunString(item.imageUrl) ??
      readLiveRunString(item.url);
    if (imageUrl !== undefined) {
      references.push(imageUrl);
    }
  }
  return uniqueStringArray(references);
}

async function directorMemefastImageReferenceToBlob(
  reference: string,
  options: {
    readonly filenamePrefix: string;
    readonly index: number;
    readonly signal?: AbortSignal;
  },
): Promise<{ readonly blob: Blob; readonly filename: string }> {
  if (/^data:/iu.test(reference)) {
    const parsed = parseDirectorMemefastDataUrl(reference);
    return {
      blob: new Blob([parsed.bytes], { type: parsed.mimeType }),
      filename: `${options.filenamePrefix}-${options.index + 1}.${mimeTypeToExtension(
        parsed.mimeType,
      )}`,
    };
  }

  const rawBase64 = normalizeDirectorMemefastRawBase64(reference);
  if (rawBase64 !== undefined) {
    const bytes = Buffer.from(rawBase64, "base64");
    return {
      blob: new Blob([bytes], { type: "image/png" }),
      filename: `${options.filenamePrefix}-${options.index + 1}.png`,
    };
  }

  const localPath = resolveDirectorMemefastLocalImagePath(reference);
  if (localPath !== undefined) {
    const bytes = readFileSync(localPath);
    const mimeType = mimeTypeFromImagePath(localPath);
    return {
      blob: new Blob([bytes], { type: mimeType }),
      filename: `${options.filenamePrefix}-${options.index + 1}.${mimeTypeToExtension(mimeType)}`,
    };
  }

  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation is available for multipart image reference upload.");
  }
  const response = await fetchImpl(reference, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch image reference for multipart upload: HTTP ${response.status}.`,
    );
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  const arrayBuffer = await response.arrayBuffer();
  return {
    blob: new Blob([arrayBuffer], { type: mimeType }),
    filename: `${options.filenamePrefix}-${options.index + 1}.${mimeTypeToExtension(mimeType)}`,
  };
}

function parseDirectorMemefastDataUrl(value: string): {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
} {
  const match = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/isu);
  if (!match?.[3]) {
    throw new Error("Invalid data URL image reference.");
  }
  const mimeType = match[1]?.trim() || "image/png";
  const bytes =
    match[2] === ";base64"
      ? Buffer.from(match[3], "base64")
      : Buffer.from(decodeURIComponent(match[3]), "utf8");
  return { bytes, mimeType };
}

function normalizeDirectorMemefastRawBase64(value: string): string | undefined {
  const compact = value.replace(/\s+/gu, "");
  if (compact.length < 128 || compact.length % 4 !== 0) {
    return undefined;
  }
  return /^[A-Za-z0-9+/]+={0,2}$/u.test(compact) ? compact : undefined;
}

function resolveDirectorMemefastLocalImagePath(value: string): string | undefined {
  if (/^local-image:\/\//iu.test(value)) {
    const rawPath = decodeURIComponent(value.slice("local-image://".length));
    const candidates = [rawPath, rawPath.startsWith("/") ? rawPath : `/${rawPath}`];
    return candidates.find((candidate) => isAbsolute(candidate) && existsSync(candidate));
  }
  if (/^file:/iu.test(value)) {
    const filePath = fileURLToPath(value);
    return existsSync(filePath) ? filePath : undefined;
  }
  if (isAbsolute(value) && existsSync(value)) {
    return value;
  }
  return undefined;
}

function mimeTypeFromImagePath(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalized.endsWith(".webp")) {
    return "image/webp";
  }
  if (normalized.endsWith(".gif")) {
    return "image/gif";
  }
  return "image/png";
}

function mimeTypeToExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) {
    return "jpg";
  }
  if (normalized.includes("webp")) {
    return "webp";
  }
  if (normalized.includes("gif")) {
    return "gif";
  }
  return "png";
}

function buildMemefastLiveRunSubmitBody(
  input: Readonly<Record<string, unknown>>,
  options: {
    readonly mediaKind: "image" | "video";
    readonly model: string;
    readonly prompt: string;
    readonly routeFamily: string;
  },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    prompt: options.prompt,
  };

  if (options.mediaKind === "image") {
    body.n = readLiveRunNumber(input.n) ?? 1;
    body.size = readLiveRunString(input.size) ?? "1024x1024";
    assignIfDefined(body, "quality", readLiveRunString(input.quality));
    assignIfDefined(body, "format", readLiveRunString(input.format));
    assignIfDefined(body, "output_format", readLiveRunString(input.outputFormat));
    assignIfDefined(body, "image", input.image);
    assignIfDefined(body, "image_url", input.imageUrl);
    assignIfDefined(body, "images", input.images);
    return body;
  }

  assignIfDefined(
    body,
    "aspect_ratio",
    readLiveRunString(input.aspect_ratio) ?? readLiveRunString(input.aspectRatio),
  );
  assignIfDefined(body, "duration", readLiveRunNumber(input.duration));
  assignIfDefined(body, "seconds", readLiveRunNumber(input.seconds));
  assignIfDefined(body, "size", readLiveRunString(input.size));
  assignIfDefined(body, "resolution", readLiveRunString(input.resolution));
  assignIfDefined(
    body,
    "image_url",
    readLiveRunString(input.image_url) ?? readLiveRunString(input.imageUrl),
  );
  assignIfDefined(body, "images", input.images);
  assignIfDefined(
    body,
    "video_url",
    readLiveRunString(input.video_url) ?? readLiveRunString(input.videoUrl),
  );
  assignIfDefined(body, "references", input.references);
  assignIfDefined(body, "operation", readLiveRunString(input.operation));
  if (options.routeFamily === "openai_official" && body.seconds === undefined) {
    assignIfDefined(body, "seconds", readLiveRunNumber(input.duration));
  }
  return body;
}

async function fetchMemefastLiveRunJson(
  context: MemefastLiveRunContext,
  url: string,
  input: {
    readonly method: "GET" | "POST";
    readonly body?: Readonly<Record<string, unknown>> | FormData;
    readonly signal?: AbortSignal;
  },
): Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly body: unknown;
}> {
  if (!context.apiKey) {
    throw createMemefastLiveRunError({
      code: "memefast-api-key-missing",
      message: "No MemeFast API key is configured.",
      retryable: false,
    });
  }
  if (typeof context.fetchImpl !== "function") {
    throw createMemefastLiveRunError({
      code: "memefast-fetch-missing",
      message: "No fetch implementation is available for MemeFast live runner.",
      retryable: true,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, context.timeoutMs);
  try {
    const isMultipartBody = input.body instanceof FormData;
    const response = await context.fetchImpl(url, {
      method: input.method,
      headers: createMemefastLiveRunJsonHeaders(context, url, !isMultipartBody),
      ...(input.body === undefined
        ? {}
        : { body: isMultipartBody ? input.body : JSON.stringify(input.body) }),
      signal: input.signal ?? controller.signal,
    });
    const text = await response.text();
    const body = parseJsonOrText(text);
    if (!response.ok) {
      throw createMemefastLiveRunError({
        code: "memefast-http-error",
        message:
          extractMemefastLiveRunMessage(body) ??
          `MemeFast request failed: HTTP ${response.status} ${response.statusText || ""}`.trim(),
        retryable:
          response.status === 408 ||
          response.status === 409 ||
          response.status === 429 ||
          response.status >= 500,
        providerStatus: response.status,
        providerStatusText: response.statusText,
        metadata: { endpoint: url },
      });
    }
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function createMemefastLiveRunJsonHeaders(
  context: MemefastLiveRunContext,
  url: string,
  jsonBody = true,
): Record<string, string> {
  const apiKey = context.apiKey ?? "";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    ...(jsonBody ? { "Content-Type": "application/json" } : {}),
  };
  if (/\/openapi\/v2\//iu.test(url)) {
    return {
      ...headers,
      ...createPixVerseLiveRunHeaders(apiKey, jsonBody),
    };
  }
  return headers;
}

function createPixVerseLiveRunHeaders(apiKey: string, json: boolean): Record<string, string> {
  return {
    Accept: "application/json",
    "API-KEY": apiKey,
    "Ai-trace-id": createMemefastLiveRunTraceId("pixverse"),
    Authorization: `Bearer ${apiKey}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function createMemefastLiveRunTraceId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function extractMemefastLiveRunTaskId(value: unknown): string | undefined {
  return findMemefastStringByKeys(value, [
    "task_id",
    "taskId",
    "id",
    "request_id",
    "requestId",
    "video_id",
    "videoId",
    "prediction_id",
    "predictionId",
  ]);
}

function extractMemefastLiveRunStatus(value: unknown): string | undefined {
  return findMemefastStringByKeys(value, [
    "status",
    "state",
    "task_status",
    "taskStatus",
    "status_code",
    "statusCode",
  ])?.toLowerCase();
}

function extractMemefastLiveRunProgress(value: unknown): number | undefined {
  const raw =
    findMemefastNumberByKeys(value, ["progress", "percent", "percentage", "completion"]) ??
    readLiveRunNumber(findMemefastStringByKeys(value, ["progress", "percent", "percentage"]));
  if (raw === undefined) {
    return undefined;
  }
  const normalized = raw > 0 && raw <= 1 ? raw * 100 : raw;
  return Math.min(100, Math.max(0, Math.round(normalized)));
}

function extractMemefastLiveRunArtifacts(
  value: unknown,
  options: { readonly kind: "image" | "video" | "audio"; readonly runId: string },
): LiveRunArtifact[] {
  const urls = uniqueStringArray(findMemefastArtifactUrls(value, options.kind));
  return urls.map((url, index) => ({
    id: `${options.runId}:${options.kind}:${index}`,
    kind: options.kind,
    url,
    mimeType: inferMemefastArtifactMimeType(url, options.kind),
  }));
}

function extractMemefastLiveRunAbsoluteUrl(
  value: unknown,
  rootBaseUrl: string,
  keys: readonly string[],
): string | undefined {
  const url = findMemefastStringByKeys(value, keys);
  return url === undefined ? undefined : toMemefastAbsoluteEndpoint(rootBaseUrl, url);
}

function extractMemefastLiveRunMessage(value: unknown): string | undefined {
  if (isRecord(value)) {
    const error = value.error;
    if (typeof error === "string") {
      return error;
    }
    if (isRecord(error)) {
      return readLiveRunString(error.message) ?? readLiveRunString(error.error);
    }
  }
  return findMemefastStringByKeys(value, ["message", "msg", "error_message", "errorMessage"]);
}

function normalizeMemefastLiveRunError(error: unknown): LiveRunError {
  if (isLiveRunErrorLike(error)) {
    return error;
  }
  return createMemefastLiveRunError({
    code: "memefast-live-runner-error",
    message: toErrorMessage(error),
    retryable: false,
  });
}

function createMemefastLiveRunError(input: {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly providerStatus?: number;
  readonly providerStatusText?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}): LiveRunError {
  return {
    code: input.code,
    message: input.message,
    retryable: input.retryable,
    ...(input.providerStatus === undefined ? {} : { providerStatus: input.providerStatus }),
    ...(input.providerStatusText === undefined
      ? {}
      : { providerStatusText: input.providerStatusText }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

function readLiveRunPrompt(input: Readonly<Record<string, unknown>>): string {
  const prompt =
    readLiveRunString(input.prompt) ??
    readLiveRunString(input.text) ??
    readLiveRunString(input.description);
  if (prompt === undefined) {
    throw createMemefastLiveRunError({
      code: "memefast-prompt-missing",
      message: "Live runner input must include a prompt.",
      retryable: false,
    });
  }
  return prompt;
}

function readLiveRunFirstFrame(input: Readonly<Record<string, unknown>>): string | undefined {
  return (
    readLiveRunString(input.firstFrame) ??
    readLiveRunString(input.first_frame) ??
    readLiveRunString(input.imageUrl) ??
    readLiveRunString(input.image_url) ??
    readLiveRunImageWithRole(input, /first|start/iu)
  );
}

function readLiveRunLastFrame(input: Readonly<Record<string, unknown>>): string | undefined {
  return (
    readLiveRunString(input.lastFrame) ??
    readLiveRunString(input.last_frame) ??
    readLiveRunString(input.endFrame) ??
    readLiveRunString(input.end_frame) ??
    readLiveRunString(input.imageTail) ??
    readLiveRunString(input.image_tail) ??
    readLiveRunImageWithRole(input, /last|end|tail/iu)
  );
}

function readLiveRunReferenceImages(input: Readonly<Record<string, unknown>>): string[] {
  return uniqueStringArray([
    ...readLiveRunStringArray(input.referenceImages),
    ...readLiveRunStringArray(input.references),
    ...readLiveRunStringArray(input.images),
    ...readLiveRunStringArray(input.image_urls),
    ...readLiveRunStringArray(input.imageUrls),
    ...readLiveRunImageWithRoles(input)
      .filter((item) => item.role === undefined || !/(first|start|last|end|tail)/iu.test(item.role))
      .map((item) => item.url),
  ]);
}

function readLiveRunImageWithRole(
  input: Readonly<Record<string, unknown>>,
  rolePattern: RegExp,
): string | undefined {
  return readLiveRunImageWithRoles(input).find((item) => item.role && rolePattern.test(item.role))
    ?.url;
}

function readLiveRunImageWithRoles(
  input: Readonly<Record<string, unknown>>,
): Array<{ readonly role?: string; readonly url: string }> {
  if (!Array.isArray(input.imageWithRoles)) {
    return [];
  }
  return input.imageWithRoles
    .map((item) => (isRecord(item) ? item : undefined))
    .filter((item): item is Record<string, unknown> => item !== undefined)
    .map((item) => {
      const url =
        readLiveRunString(item.url) ??
        readLiveRunString(item.image_url) ??
        readLiveRunString(item.imageUrl);
      return {
        ...(typeof item.role === "string" ? { role: item.role } : {}),
        ...(url === undefined ? {} : { url }),
      };
    })
    .filter(
      (item): item is { readonly role?: string; readonly url: string } =>
        typeof item.url === "string",
    );
}

function readLiveRunStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(isNonEmptyString).map((item) => item.trim());
  }
  const text = readLiveRunString(value);
  if (text === undefined) {
    return [];
  }
  return text
    .split(/[,\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readLiveRunImageId(value: unknown): number | string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return readLiveRunString(value);
}

function readLiveRunImageIdArray(value: unknown): Array<number | string> {
  return Array.isArray(value)
    ? value.map(readLiveRunImageId).filter((item): item is number | string => item !== undefined)
    : [];
}

function readLiveRunString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readLiveRunNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function assignIfDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function parseJsonOrText(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { text: value };
  }
}

function findMemefastStringByKeys(value: unknown, keys: readonly string[]): string | undefined {
  for (const entry of iterateMemefastRecords(value)) {
    for (const key of keys) {
      const candidate = entry[key];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return String(candidate);
      }
    }
  }
  return undefined;
}

function findMemefastNumberByKeys(value: unknown, keys: readonly string[]): number | undefined {
  for (const entry of iterateMemefastRecords(value)) {
    for (const key of keys) {
      const candidate = readLiveRunNumber(entry[key]);
      if (candidate !== undefined) {
        return candidate;
      }
    }
  }
  return undefined;
}

function findMemefastArtifactUrls(value: unknown, kind: "image" | "video" | "audio"): string[] {
  const keys =
    kind === "image"
      ? ["url", "image", "image_url", "imageUrl", "download_url", "file_url", "asset_url"]
      : kind === "video"
        ? [
            "url",
            "video",
            "video_url",
            "videoUrl",
            "output_url",
            "download_url",
            "file_url",
            "asset_url",
          ]
        : [
            "url",
            "audio",
            "audio_url",
            "audioUrl",
            "stream_audio_url",
            "source_audio_url",
            "download_url",
            "file_url",
            "asset_url",
          ];
  const urls: string[] = [];
  for (const entry of iterateMemefastRecords(value, 5)) {
    for (const [key, candidate] of Object.entries(entry)) {
      if (!keys.includes(key) || typeof candidate !== "string") {
        continue;
      }
      if (/poll|cancel|status|task/iu.test(key)) {
        continue;
      }
      const normalized = candidate.trim();
      if (/^(https?:\/\/|data:)/iu.test(normalized)) {
        urls.push(normalized);
      }
    }
  }
  return urls;
}

function iterateMemefastRecords(value: unknown, maxDepth = 4): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const visit = (entry: unknown, depth: number) => {
    if (depth > maxDepth || entry === null || entry === undefined || seen.has(entry)) {
      return;
    }
    seen.add(entry);
    if (Array.isArray(entry)) {
      for (const item of entry) {
        visit(item, depth + 1);
      }
      return;
    }
    if (!isRecord(entry)) {
      return;
    }
    records.push(entry);
    for (const key of [
      "data",
      "Resp",
      "Response",
      "response",
      "result",
      "results",
      "output",
      "outputs",
      "task",
      "task_result",
      "payload",
      "creation",
      "creations",
      "artifact",
      "artifacts",
      "file",
      "files",
      "image",
      "images",
      "video",
      "videos",
      "audio",
      "audios",
    ]) {
      visit(entry[key], depth + 1);
    }
  };
  visit(value, 0);
  return records;
}

function isMemefastTerminalSuccessStatus(status: string | undefined): boolean {
  return status !== undefined && MEMEFAST_TERMINAL_SUCCESS_STATUSES.has(status.toLowerCase());
}

function isMemefastTerminalFailureStatus(status: string | undefined): boolean {
  return status !== undefined && MEMEFAST_TERMINAL_FAILURE_STATUSES.has(status.toLowerCase());
}

function inferMemefastArtifactMimeType(url: string, kind: "image" | "video" | "audio"): string {
  const lower = url.toLowerCase();
  if (lower.startsWith("data:")) {
    return lower.slice(5, lower.indexOf(";") > 0 ? lower.indexOf(";") : undefined);
  }
  if (kind === "image") {
    if (lower.includes(".webp")) {
      return "image/webp";
    }
    if (lower.includes(".jpg") || lower.includes(".jpeg")) {
      return "image/jpeg";
    }
    return "image/png";
  }
  if (kind === "audio") {
    if (lower.includes(".wav")) {
      return "audio/wav";
    }
    if (lower.includes(".m4a")) {
      return "audio/mp4";
    }
    if (lower.includes(".ogg")) {
      return "audio/ogg";
    }
    if (lower.includes(".flac")) {
      return "audio/flac";
    }
    return "audio/mpeg";
  }
  if (lower.includes(".webm")) {
    return "video/webm";
  }
  if (lower.includes(".mov")) {
    return "video/quicktime";
  }
  return "video/mp4";
}

function toMemefastAbsoluteEndpoint(rootBaseUrl: string, pathOrUrl: string): string {
  if (/^https?:\/\//iu.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${normalizeBaseUrl(rootBaseUrl)}${path}`;
}

function defaultMemefastLiveRunCancelUrl(rootBaseUrl: string, taskId: string): string {
  return toMemefastAbsoluteEndpoint(rootBaseUrl, `/v1/tasks/${encodeURIComponent(taskId)}/cancel`);
}

function resolveMemefastSeedanceTaskSubmitUrl(baseUrl: string): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedLower = normalizedBaseUrl.toLowerCase();
  if (/\/contents\/generations\/tasks$/iu.test(normalizedLower)) {
    return normalizedBaseUrl;
  }
  if (/\/api\/v\d+$/iu.test(normalizedLower) || /\/volc\/v\d+$/iu.test(normalizedLower)) {
    return `${normalizedBaseUrl}/contents/generations/tasks`;
  }
  if (/https?:\/\/ark\.[^/]+\.volces\.com(?:\/|$)/iu.test(normalizedBaseUrl)) {
    return `${normalizedBaseUrl}/api/v3/contents/generations/tasks`;
  }
  return `${normalizeProviderRootBaseUrl(normalizedBaseUrl)}/volc/v1/contents/generations/tasks`;
}

function readKlingVideoOperation(model: string, endpointTypes: readonly string[]): string {
  const joined = `${model} ${endpointTypes.join(" ")}`.toLowerCase();
  if (/omni[-_ ]?video|kling-v3-omni/iu.test(joined)) {
    return "omni-video";
  }
  if (/延长|extend/iu.test(joined)) {
    return "video-extend";
  }
  if (/动作控制|motion/iu.test(joined)) {
    return "motion-control";
  }
  if (/多元素|multi-elements/iu.test(joined)) {
    return "multi-elements";
  }
  if (/数字人|avatar/iu.test(joined)) {
    return "avatar/image2video";
  }
  if (/对口型|lip/iu.test(joined)) {
    return "advanced-lip-sync";
  }
  if (/特效|effects/iu.test(joined)) {
    return "effects";
  }
  if (/图生视频|image|i2v/iu.test(joined)) {
    return "image2video";
  }
  return "text2video";
}

function isLiveRunErrorLike(value: unknown): value is LiveRunError {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    typeof value.retryable === "boolean"
  );
}

function buildProviderAdapters(
  storedProviders: readonly StoredDirectorApiProvider[],
): DirectorApiProviderAdapter[] {
  const byId = new Map(storedProviders.map((provider) => [provider.id, provider]));
  return [createMemefastApiProviderAdapter(byId.get("memefast-api") ?? {})];
}

function defaultStoredProvider(): StoredDirectorApiProvider {
  return {
    id: "memefast-api",
    platform: "memefast",
    name: "魔因API",
    baseUrl: "https://memefast.top",
    enabled: true,
    apiKey: "",
    apiKeyEnvVar: "MEMEFAST_API_KEY",
    models: [...MEMEFAST_MODELS],
    capabilities: [...MEMEFAST_CAPABILITIES],
    defaultModels: { ...MEMEFAST_DEFAULT_MODELS },
  };
}

function ensureStoredProviders(
  providers: readonly StoredDirectorApiProvider[],
): StoredDirectorApiProvider[] {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const storedMemefast = byId.get("memefast-api");
  return [
    normalizeMemefastStoredProvider({
      ...defaultStoredProvider(),
      ...(storedMemefast ?? {}),
    }),
  ];
}

function normalizeMemefastStoredProvider(
  provider: StoredDirectorApiProvider,
): StoredDirectorApiProvider {
  return {
    ...provider,
    models: mergeMemefastSourceManagedModels(provider.models),
    capabilities: uniqueCapabilities([...(provider.capabilities ?? []), ...MEMEFAST_CAPABILITIES]),
    defaultModels: {
      ...MEMEFAST_DEFAULT_MODELS,
      ...(provider.defaultModels ?? {}),
    },
  };
}

function mergeMemefastSourceManagedModels(models: readonly string[] | undefined): string[] {
  return uniqueStringArray([...(models ?? []), ...MEMEFAST_MODELS]);
}

function applyProviderSetting(
  provider: StoredDirectorApiProvider,
  update: DirectorApiProviderSettingUpdate,
): StoredDirectorApiProvider {
  switch (update.key) {
    case "enabled":
      return { ...provider, enabled: requireBoolean(update.value, update.key) };
    case "apiKey":
      return { ...provider, apiKey: requireString(update.value, update.key) };
    case "baseUrl":
      return { ...provider, baseUrl: normalizeBaseUrl(requireAbsoluteUrl(update.value)) };
    case "models":
      return { ...provider, models: parseModelList(update.value) };
    case "defaultTextModel":
      return updateDefaultModel(provider, "text", update.value);
    case "defaultVisionModel":
      return updateDefaultModel(provider, "vision", update.value);
    case "defaultImageModel":
      return updateDefaultModel(provider, "image_generation", update.value);
    case "defaultVideoModel":
      return updateDefaultModel(provider, "video_generation", update.value);
    case "defaultAudioModel":
      return updateDefaultModel(provider, "audio_generation", update.value);
  }
}

function parseModelList(value: string | boolean): string[] {
  const raw = requireString(value, "models");
  const models = Array.from(
    new Set(
      raw
        .split(/[,\n]/u)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
  if (models.length === 0) {
    throw new Error("models must include at least one model id.");
  }
  return models;
}

function updateDefaultModel(
  provider: StoredDirectorApiProvider,
  key: keyof DirectorApiProviderDefaults,
  value: string | boolean,
): StoredDirectorApiProvider {
  return {
    ...provider,
    defaultModels: {
      ...(provider.defaultModels ?? {}),
      [key]: requireString(value, key),
    },
  };
}

function loadStoredDocument(rootPath: string): StoredDirectorApiProviderConfigDocument {
  const path = configPath(rootPath);
  if (!existsSync(path)) {
    return {
      schemaVersion: DIRECTOR_API_PROVIDER_CONFIG_SCHEMA_VERSION,
      updatedAt: new Date(0).toISOString(),
      providers: [defaultStoredProvider()],
    };
  }

  try {
    const parsed = parseStoredDocument(JSON.parse(readFileSync(path, "utf8")) as unknown);
    return {
      ...parsed,
      providers: ensureStoredProviders(parsed.providers),
    };
  } catch {
    return {
      schemaVersion: DIRECTOR_API_PROVIDER_CONFIG_SCHEMA_VERSION,
      updatedAt: new Date(0).toISOString(),
      providers: [defaultStoredProvider()],
    };
  }
}

function parseStoredDocument(value: unknown): StoredDirectorApiProviderConfigDocument {
  if (!isRecord(value)) {
    throw new Error("API provider config must be an object.");
  }
  if (value.schemaVersion !== DIRECTOR_API_PROVIDER_CONFIG_SCHEMA_VERSION) {
    throw new Error("API provider config schema version is invalid.");
  }
  if (!Array.isArray(value.providers)) {
    throw new Error("API provider config providers must be an array.");
  }

  return {
    schemaVersion: DIRECTOR_API_PROVIDER_CONFIG_SCHEMA_VERSION,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
    providers: value.providers.map(parseStoredProvider),
  };
}

function parseStoredProvider(value: unknown): StoredDirectorApiProvider {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.trim().length === 0) {
    throw new Error("API provider must include id.");
  }

  return {
    id: value.id,
    ...(typeof value.platform === "string" ? { platform: value.platform } : {}),
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.baseUrl === "string" ? { baseUrl: value.baseUrl } : {}),
    ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
    ...(typeof value.apiKey === "string" ? { apiKey: value.apiKey } : {}),
    ...(typeof value.apiKeyEnvVar === "string" ? { apiKeyEnvVar: value.apiKeyEnvVar } : {}),
    ...(Array.isArray(value.models) ? { models: value.models.filter(isString) } : {}),
    ...(Array.isArray(value.capabilities)
      ? { capabilities: value.capabilities.filter(isCapability) }
      : {}),
    ...(typeof value.contextLimit === "number" && Number.isFinite(value.contextLimit)
      ? { contextLimit: value.contextLimit }
      : {}),
    ...(isRecord(value.defaultModels)
      ? { defaultModels: parseDefaultModels(value.defaultModels) }
      : {}),
    ...(isRecord(value.modelEndpointTypes)
      ? { modelEndpointTypes: parseStringArrayRecord(value.modelEndpointTypes) }
      : {}),
    ...(isRecord(value.modelTypes) ? { modelTypes: parseStringRecord(value.modelTypes) } : {}),
    ...(isRecord(value.modelTags) ? { modelTags: parseStringArrayRecord(value.modelTags) } : {}),
    ...(isRecord(value.modelEnableGroups)
      ? { modelEnableGroups: parseStringArrayRecord(value.modelEnableGroups) }
      : {}),
  };
}

function parseDefaultModels(value: Record<string, unknown>): Partial<DirectorApiProviderDefaults> {
  return {
    ...(typeof value.text === "string" ? { text: value.text } : {}),
    ...(typeof value.vision === "string" ? { vision: value.vision } : {}),
    ...(typeof value.image_generation === "string"
      ? { image_generation: value.image_generation }
      : {}),
    ...(typeof value.video_generation === "string"
      ? { video_generation: value.video_generation }
      : {}),
    ...(typeof value.audio_generation === "string"
      ? { audio_generation: value.audio_generation }
      : {}),
  };
}

function parseStringRecord(value: Record<string, unknown>): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== "string") {
      continue;
    }
    const normalized = entryValue.trim();
    if (normalized.length > 0) {
      record[key] = normalized;
    }
  }
  return record;
}

function parseStringArrayRecord(value: Record<string, unknown>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entryValue]) => [key, parseUnknownStringList(entryValue)] as const)
      .filter(([, items]) => items.length > 0),
  );
}

async function writeStoredDocument(
  rootPath: string,
  document: StoredDirectorApiProviderConfigDocument,
): Promise<void> {
  const path = configPath(rootPath);
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

function configPath(rootPath: string): string {
  return join(rootPath, "providers.json");
}

function connectionTestResult(input: {
  readonly input: DirectorApiProviderConnectionTestInput;
  readonly checkedAt: string;
  readonly startedAt: number;
  readonly endpointUrl: string;
  readonly ok: boolean;
  readonly message: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly modelCount?: number;
}): DirectorApiProviderConnectionTestResult {
  return {
    providerId: input.input.providerId,
    ok: input.ok,
    endpoint: input.endpointUrl,
    checkedAt: input.checkedAt,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.statusText === undefined ? {} : { statusText: input.statusText }),
    ...(input.modelCount === undefined ? {} : { modelCount: input.modelCount }),
    message: input.message,
  };
}

function textCompletionResult(input: {
  readonly input: DirectorApiProviderTextCompletionInput;
  readonly providerId: string;
  readonly checkedAt: string;
  readonly startedAt: number;
  readonly endpointUrl: string;
  readonly model: string;
  readonly ok: boolean;
  readonly message: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly output?: string;
  readonly toolCalls?: readonly DirectorApiProviderToolCall[];
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly retryCount?: number;
  readonly fallbackKeysTried?: number;
  readonly fallbackModelsTried?: readonly string[];
}): DirectorApiProviderTextCompletionResult {
  return {
    providerId: input.providerId,
    ok: input.ok,
    endpoint: input.endpointUrl,
    checkedAt: input.checkedAt,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    model: input.model,
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.statusText === undefined ? {} : { statusText: input.statusText }),
    ...(input.output === undefined ? {} : { output: input.output }),
    ...(input.toolCalls === undefined ? {} : { toolCalls: input.toolCalls }),
    ...(input.promptTokens === undefined ? {} : { promptTokens: input.promptTokens }),
    ...(input.completionTokens === undefined ? {} : { completionTokens: input.completionTokens }),
    ...(input.retryCount === undefined || input.retryCount <= 0
      ? {}
      : { retryCount: input.retryCount }),
    ...(input.fallbackKeysTried === undefined || input.fallbackKeysTried <= 1
      ? {}
      : { fallbackKeysTried: input.fallbackKeysTried }),
    ...(input.fallbackModelsTried === undefined || input.fallbackModelsTried.length <= 1
      ? {}
      : { fallbackModelsTried: input.fallbackModelsTried }),
    message: input.message,
  };
}

function imageGenerationResult(input: {
  readonly input: DirectorApiProviderImageGenerationInput;
  readonly providerId: string;
  readonly checkedAt: string;
  readonly startedAt: number;
  readonly endpointUrl: string;
  readonly model: string;
  readonly ok: boolean;
  readonly images: readonly DirectorApiProviderGeneratedImage[];
  readonly message: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly output?: string;
  readonly retryCount?: number;
  readonly fallbackKeysTried?: number;
}): DirectorApiProviderImageGenerationResult {
  return {
    providerId: input.providerId,
    ok: input.ok,
    endpoint: input.endpointUrl,
    checkedAt: input.checkedAt,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    model: input.model,
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.statusText === undefined ? {} : { statusText: input.statusText }),
    images: input.images,
    ...(input.output === undefined ? {} : { output: input.output }),
    ...(input.retryCount === undefined || input.retryCount <= 0
      ? {}
      : { retryCount: input.retryCount }),
    ...(input.fallbackKeysTried === undefined || input.fallbackKeysTried <= 1
      ? {}
      : { fallbackKeysTried: input.fallbackKeysTried }),
    message: input.message,
  };
}

function modelSyncResult(input: {
  readonly input: DirectorApiProviderModelSyncInput;
  readonly syncedAt: string;
  readonly startedAt: number;
  readonly pricingEndpoint: string;
  readonly modelsEndpoint: string;
  readonly ok: boolean;
  readonly count: number;
  readonly metadataCount: number;
  readonly endpointTypeCount: number;
  readonly accountModelStatusCount: number;
  readonly message: string;
  readonly config: LoadDirectorApiProviderConfigResult;
  readonly pricingStatus?: number;
}): DirectorApiProviderModelSyncResult {
  return {
    providerId: input.input.providerId,
    ok: input.ok,
    pricingEndpoint: input.pricingEndpoint,
    modelsEndpoint: input.modelsEndpoint,
    syncedAt: input.syncedAt,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    count: input.count,
    metadataCount: input.metadataCount,
    endpointTypeCount: input.endpointTypeCount,
    ...(input.pricingStatus === undefined ? {} : { pricingStatus: input.pricingStatus }),
    accountModelStatusCount: input.accountModelStatusCount,
    message: input.message,
    config: input.config,
  };
}

function selectTextProvider(
  providers: readonly DirectorApiProviderAdapter[],
  providerId: string | undefined,
  capabilityRoute: DirectorApiProviderTextCompletionCapabilityRoute | undefined,
): DirectorApiProviderAdapter | undefined {
  const requiredCapability = resolveTextCompletionRequiredProviderCapability(capabilityRoute);
  if (providerId) {
    return providers.find((provider) => provider.id === providerId);
  }
  return (
    providers.find(
      (provider) =>
        provider.enabled &&
        provider.apiKeyConfigured &&
        provider.capabilities.includes(requiredCapability),
    ) ?? providers.find((provider) => provider.capabilities.includes(requiredCapability))
  );
}

function selectImageProvider(
  providers: readonly DirectorApiProviderAdapter[],
  providerId: string | undefined,
): DirectorApiProviderAdapter | undefined {
  if (providerId) {
    return providers.find((provider) => provider.id === providerId);
  }
  return (
    providers.find(
      (provider) =>
        provider.enabled &&
        provider.apiKeyConfigured &&
        provider.capabilities.includes("image_generation"),
    ) ?? providers.find((provider) => provider.capabilities.includes("image_generation"))
  );
}

function parseOpenAiResponsesOutput(value: Record<string, unknown>): string | undefined {
  const outputText = readString(value.output_text);
  if (outputText !== undefined) {
    return outputText;
  }
  if (!Array.isArray(value.output)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const item of value.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (!isRecord(content)) {
        continue;
      }
      const text = readString(content.text);
      if (text !== undefined) {
        parts.push(text);
      }
    }
  }
  return parts.length === 0 ? undefined : parts.join("");
}

function parseAnthropicMessagesOutput(value: Record<string, unknown>): string | undefined {
  if (!Array.isArray(value.content)) {
    return undefined;
  }
  const parts = value.content
    .map((item) => (isRecord(item) ? readString(item.text) : undefined))
    .filter(isNonEmptyString);
  return parts.length === 0 ? undefined : parts.join("");
}

function parseGeminiGenerateContentOutput(value: Record<string, unknown>): string | undefined {
  const candidates = Array.isArray(value.candidates) ? value.candidates : [];
  const candidate = candidates.find(isRecord);
  if (!candidate || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) {
    return undefined;
  }
  const parts = candidate.content.parts
    .map((item) => (isRecord(item) ? readString(item.text) : undefined))
    .filter(isNonEmptyString);
  return parts.length === 0 ? undefined : parts.join("");
}

function parseTextCompletionResponse(value: string): {
  readonly output?: string;
  readonly toolCalls?: readonly DirectorApiProviderToolCall[];
  readonly promptTokens?: number;
  readonly completionTokens?: number;
} {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }
    const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : undefined;
    const responsesOutput = parseOpenAiResponsesOutput(parsed);
    const anthropicOutput = parseAnthropicMessagesOutput(parsed);
    const geminiOutput = parseGeminiGenerateContentOutput(parsed);
    const output =
      responsesOutput ??
      anthropicOutput ??
      geminiOutput ??
      (isRecord(choice) && isRecord(choice.message) && typeof choice.message.content === "string"
        ? choice.message.content
        : undefined);
    const toolCalls =
      isRecord(choice) && isRecord(choice.message)
        ? parseTextCompletionToolCalls(choice.message.tool_calls)
        : [];
    const usage = isRecord(parsed.usage) ? parsed.usage : {};
    const usageMetadata = isRecord(parsed.usageMetadata) ? parsed.usageMetadata : {};
    const promptTokens =
      typeof usage.prompt_tokens === "number"
        ? usage.prompt_tokens
        : typeof usage.input_tokens === "number"
          ? usage.input_tokens
          : typeof usageMetadata.promptTokenCount === "number"
            ? usageMetadata.promptTokenCount
            : undefined;
    const completionTokens =
      typeof usage.completion_tokens === "number"
        ? usage.completion_tokens
        : typeof usage.output_tokens === "number"
          ? usage.output_tokens
          : typeof usageMetadata.candidatesTokenCount === "number"
            ? usageMetadata.candidatesTokenCount
            : undefined;
    return {
      ...(output === undefined ? {} : { output }),
      ...(toolCalls.length === 0 ? {} : { toolCalls }),
      ...(promptTokens === undefined ? {} : { promptTokens }),
      ...(completionTokens === undefined ? {} : { completionTokens }),
    };
  } catch {
    return {};
  }
}

interface DirectorApiProviderTextCompletionStreamChunk {
  readonly choices: Array<{
    readonly delta?: {
      readonly content?: string;
      readonly tool_calls?: Array<{
        readonly id?: string;
        readonly function?: { readonly name?: string; readonly arguments?: string };
      }>;
    };
    readonly finish_reason?: string | null;
  }>;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
  readonly syntheticFromJsonFallback?: boolean;
}

function isTextCompletionStreamChunk(
  value: unknown,
): value is DirectorApiProviderTextCompletionStreamChunk {
  return isRecord(value) && Array.isArray(value.choices);
}

function parseTextCompletionStreamBlock(
  block: string,
): DirectorApiProviderTextCompletionStreamChunk | undefined {
  const payload = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n")
    .trim();
  if (!payload || payload === "[DONE]") {
    return undefined;
  }
  const parsed = JSON.parse(payload) as unknown;
  if (!isTextCompletionStreamChunk(parsed)) {
    throw new Error("Text completion stream chunk is missing choices.");
  }
  return parsed;
}

function drainTextCompletionStreamBuffer(bufferState: {
  buffer: string;
}): DirectorApiProviderTextCompletionStreamChunk[] {
  const chunks: DirectorApiProviderTextCompletionStreamChunk[] = [];
  bufferState.buffer = bufferState.buffer.replace(/\r\n/g, "\n");
  while (true) {
    const boundary = bufferState.buffer.indexOf("\n\n");
    if (boundary < 0) {
      break;
    }
    const block = bufferState.buffer.slice(0, boundary);
    bufferState.buffer = bufferState.buffer.slice(boundary + 2);
    const parsed = parseTextCompletionStreamBlock(block);
    if (parsed) {
      chunks.push(parsed);
    }
  }
  return chunks;
}

async function* iterateTextCompletionStreamChunks(response: {
  body?: ReadableStream<Uint8Array> | null;
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
}): AsyncGenerator<DirectorApiProviderTextCompletionStreamChunk> {
  const contentType = response.headers?.get("content-type") ?? "";
  if (response.body && (response.headers === undefined || /event-stream/i.test(contentType))) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const bufferState = { buffer: "" };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        bufferState.buffer += decoder.decode(value, { stream: true });
        yield* drainTextCompletionStreamBuffer(bufferState);
      }
      bufferState.buffer += decoder.decode();
      yield* drainTextCompletionStreamBuffer(bufferState);
    } finally {
      reader.releaseLock();
    }
    return;
  }

  const text = await response.text();
  const chunks = drainTextCompletionStreamBuffer({ buffer: text });
  if (chunks.length > 0) {
    yield* chunks;
    return;
  }
  const parsed = parseTextCompletionResponse(text);
  const output = parsed.output?.trim();
  const toolCalls = parsed.toolCalls ?? [];
  if ((output !== undefined && output.length > 0) || toolCalls.length > 0) {
    const delta = {
      ...(output === undefined || output.length === 0 ? {} : { content: output }),
      ...(toolCalls.length === 0
        ? {}
        : {
            tool_calls: toolCalls.map((call) => ({
              id: call.id,
              function: {
                name: call.name,
                arguments: JSON.stringify(call.args),
              },
            })),
          }),
    };
    yield {
      choices: [
        {
          delta,
        },
      ],
      syntheticFromJsonFallback: true,
      ...(parsed.promptTokens === undefined && parsed.completionTokens === undefined
        ? {}
        : {
            usage: {
              ...(parsed.promptTokens === undefined ? {} : { prompt_tokens: parsed.promptTokens }),
              ...(parsed.completionTokens === undefined
                ? {}
                : { completion_tokens: parsed.completionTokens }),
            },
          }),
    };
  }
}

async function consumeTextCompletionStreamResponse(
  response: {
    body?: ReadableStream<Uint8Array> | null;
    headers?: { get(name: string): string | null };
    text(): Promise<string>;
  },
  onStreamDelta?: (delta: string) => void,
): Promise<{
  readonly output?: string;
  readonly toolCalls?: readonly DirectorApiProviderToolCall[];
  readonly promptTokens?: number;
  readonly completionTokens?: number;
}> {
  const outputParts: string[] = [];
  const toolCallsByIndex = new Map<number, { id?: string; name?: string; argumentsJson: string }>();
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;

  for await (const chunk of iterateTextCompletionStreamChunks(response)) {
    for (const choice of chunk.choices) {
      const text = choice.delta?.content;
      if (text) {
        outputParts.push(text);
        if (chunk.syntheticFromJsonFallback !== true) {
          onStreamDelta?.(text);
        }
      }
      for (const [index, toolCall] of (choice.delta?.tool_calls ?? []).entries()) {
        const existing = toolCallsByIndex.get(index) ?? { argumentsJson: "" };
        const nextToolCall: { id?: string; name?: string; argumentsJson: string } = {
          argumentsJson: `${existing.argumentsJson}${toolCall.function?.arguments ?? ""}`,
        };
        const nextId = toolCall.id ?? existing.id;
        const nextName = toolCall.function?.name ?? existing.name;
        if (nextId !== undefined) {
          nextToolCall.id = nextId;
        }
        if (nextName !== undefined) {
          nextToolCall.name = nextName;
        }
        toolCallsByIndex.set(index, nextToolCall);
      }
    }
    if (chunk.usage?.prompt_tokens !== undefined) {
      promptTokens = chunk.usage.prompt_tokens;
    }
    if (chunk.usage?.completion_tokens !== undefined) {
      completionTokens = chunk.usage.completion_tokens;
    }
  }

  const toolCalls = [...toolCallsByIndex.entries()]
    .map(([index, toolCall]) =>
      toolCall.name === undefined
        ? null
        : {
            id: toolCall.id ?? `tool-call-${index}`,
            name: toolCall.name,
            args: parseToolArguments(toolCall.argumentsJson),
          },
    )
    .filter((toolCall): toolCall is DirectorApiProviderToolCall => toolCall !== null);

  return {
    ...(outputParts.length === 0 ? {} : { output: outputParts.join("") }),
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens }),
  };
}

function buildTextCompletionMessages(
  input: DirectorApiProviderTextCompletionInput,
  model?: string,
): Array<Record<string, unknown>> {
  const userContent = buildTextCompletionUserContent(input);
  const messages =
    input.messages === undefined || input.messages.length === 0
      ? [
          {
            role: "system" as const,
            content:
              input.systemPrompt ??
              "你是 Director Angel 的真实模型执行层。直接回答用户，不要声称自己只是状态检查。",
          },
          { role: "user" as const, content: userContent },
        ]
      : input.messages;
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
    ...(message.toolCalls === undefined || message.toolCalls.length === 0
      ? {}
      : {
          tool_calls: message.toolCalls.map((call) =>
            createTextCompletionToolCallPayload(call, input, model),
          ),
        }),
  }));
}

function buildTextCompletionUserContent(
  input: DirectorApiProviderTextCompletionInput,
): string | DirectorApiProviderTextContentPart[] {
  const prompt = input.prompt.trim();
  const referenceImages = uniqueStringArray([...(input.referenceImages ?? [])]);
  if (referenceImages.length === 0) {
    return prompt;
  }
  return [
    { type: "text", text: prompt },
    ...referenceImages.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];
}

function createTextCompletionToolCallPayload(
  call: DirectorApiProviderToolCall,
  input: DirectorApiProviderTextCompletionInput,
  model: string | undefined,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: call.id,
    type: "function",
    function: {
      name: call.name,
      arguments: JSON.stringify(call.args),
    },
  };
  const extraContent = resolveTextCompletionToolCallExtraContent(call, input, model);
  if (extraContent !== undefined) {
    payload.extra_content = extraContent;
  }
  return payload;
}

function resolveTextCompletionToolCallExtraContent(
  call: DirectorApiProviderToolCall,
  input: DirectorApiProviderTextCompletionInput,
  model: string | undefined,
): Readonly<Record<string, unknown>> | undefined {
  const existing = readToolCallExtraContent(call.metadata);
  if (existing !== undefined) {
    return existing;
  }
  if (!shouldAddGeminiToolReplayThoughtSignature(input, model)) {
    return undefined;
  }
  return {
    google: {
      thought_signature: "skip_thought_signature_validator",
    },
  };
}

function shouldAddGeminiToolReplayThoughtSignature(
  input: DirectorApiProviderTextCompletionInput,
  model: string | undefined,
): boolean {
  const selectedModel = model?.trim() || input.model?.trim();
  if (selectedModel !== undefined && selectedModel.length > 0) {
    return isGemini3TextModel(selectedModel);
  }
  return false;
}

function isGemini3TextModel(model: string): boolean {
  return /^gemini-3(?:[./_-]|$)/iu.test(model) || /^gemini-3\./iu.test(model);
}

function readToolCallExtraContent(
  metadata: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  const extraContent = metadata.extra_content ?? metadata.extraContent;
  return isRecord(extraContent) ? extraContent : undefined;
}

function parseTextCompletionToolCalls(value: unknown): DirectorApiProviderToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((call, index) => parseTextCompletionToolCall(call, index))
    .filter((call) => call !== null);
}

function parseTextCompletionToolCall(
  value: unknown,
  index: number,
): DirectorApiProviderToolCall | null {
  if (!isRecord(value)) {
    return null;
  }
  const fn = isRecord(value.function) ? value.function : {};
  const name = readString(fn.name);
  if (name === undefined) {
    return null;
  }
  return {
    id: readString(value.id) ?? `tool-call-${index}`,
    name,
    args: parseToolArguments(readString(fn.arguments)),
    ...parseTextCompletionToolCallMetadata(value),
  };
}

function parseTextCompletionToolCallMetadata(
  value: Record<string, unknown>,
): { readonly metadata: Readonly<Record<string, unknown>> } | Record<string, never> {
  const extraContent = value.extra_content ?? value.extraContent;
  return isRecord(extraContent)
    ? {
        metadata: {
          extra_content: extraContent,
        },
      }
    : {};
}

function parseToolArguments(value: string | undefined): Readonly<Record<string, unknown>> {
  if (value === undefined || value.trim().length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseImageGenerationResponse(value: string): {
  readonly images: readonly DirectorApiProviderGeneratedImage[];
  readonly output?: string;
} {
  try {
    const parsed = JSON.parse(value) as unknown;
    const topLevelImage = parseGeneratedImage(parsed);
    const data = isRecord(parsed) && Array.isArray(parsed.data) ? parsed.data : [];
    const output = isRecord(parsed) && Array.isArray(parsed.output) ? parsed.output : [];
    const choiceImages =
      isRecord(parsed) && Array.isArray(parsed.choices)
        ? parsed.choices.flatMap(parseGeneratedImagesFromChoice)
        : [];
    const images = [
      ...(topLevelImage === null ? [] : [topLevelImage]),
      ...data.map(parseGeneratedImage).filter((image) => image !== null),
      ...output.map(parseGeneratedImage).filter((image) => image !== null),
      ...choiceImages,
    ];
    const first = images[0];
    return {
      images,
      ...(first?.url === undefined
        ? first?.b64Json === undefined
          ? {}
          : { output: `base64 image (${first.b64Json.length} chars)` }
        : { output: first.url }),
    };
  } catch {
    return { images: [] };
  }
}

function parseGeneratedImagesFromChoice(value: unknown): DirectorApiProviderGeneratedImage[] {
  if (!isRecord(value) || !isRecord(value.message)) {
    return [];
  }
  return parseGeneratedImagesFromContent(value.message.content);
}

function parseGeneratedImagesFromContent(value: unknown): DirectorApiProviderGeneratedImage[] {
  if (typeof value === "string") {
    const images: DirectorApiProviderGeneratedImage[] = [];
    const markdownPattern = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/giu;
    for (const match of value.matchAll(markdownPattern)) {
      if (match[1]) {
        images.push({ url: match[1] });
      }
    }
    const dataPattern = /(data:image\/[^;\s]+;base64,[A-Za-z0-9+/=]+)/gu;
    for (const match of value.matchAll(dataPattern)) {
      if (match[1]) {
        images.push({ url: match[1] });
      }
    }
    return images;
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((part) => {
    const parsed = parseGeneratedImage(part);
    return parsed === null ? [] : [parsed];
  });
}

function parseGeneratedImage(value: unknown): DirectorApiProviderGeneratedImage | null {
  if (!isRecord(value)) {
    return null;
  }
  const nestedImageUrl = isRecord(value.image_url) ? value.image_url : {};
  const url =
    readString(value.url) ??
    readString(value.image_url) ??
    readString(value.image) ??
    readString(nestedImageUrl.url);
  const b64Json =
    readString(value.b64_json) ??
    readString(value.base64) ??
    readString(value.image_base64) ??
    readString(value.data);
  const revisedPrompt = readString(value.revised_prompt);

  if (url === undefined && b64Json === undefined) {
    return null;
  }

  return {
    ...(url === undefined ? {} : { url }),
    ...(b64Json === undefined ? {} : { b64Json }),
    ...(revisedPrompt === undefined ? {} : { revisedPrompt }),
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseModelCount(value: string): number | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (isRecord(parsed) && Array.isArray(parsed.data)) {
      return parsed.data.length;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function parseMemefastPricingModels(value: string): Array<{
  readonly modelName: string;
  readonly modelType?: string;
  readonly tags: readonly string[];
  readonly endpointTypes: readonly string[];
  readonly enableGroups: readonly string[];
}> {
  try {
    const parsed = JSON.parse(value) as unknown;
    const data = isRecord(parsed) && Array.isArray(parsed.data) ? parsed.data : [];
    return data.map(parseMemefastPricingModel).filter((model) => model !== null);
  } catch {
    return [];
  }
}

function parseMemefastPricingModel(value: unknown): {
  readonly modelName: string;
  readonly modelType?: string;
  readonly tags: readonly string[];
  readonly endpointTypes: readonly string[];
  readonly enableGroups: readonly string[];
} | null {
  if (!isRecord(value)) {
    return null;
  }
  const modelName = readString(value.model_name)?.trim();
  if (!modelName) {
    return null;
  }
  const modelType = readString(value.model_type)?.trim();
  return {
    modelName,
    ...(modelType === undefined || modelType.length === 0 ? {} : { modelType }),
    tags: parseUnknownStringList(value.tags),
    endpointTypes: parseUnknownStringList(value.supported_endpoint_types),
    enableGroups: parseUnknownStringList(value.enable_groups),
  };
}

function parseModelListResponse(value: string): Array<{
  readonly id: string;
  readonly endpointTypes: readonly string[];
}> {
  try {
    const parsed = JSON.parse(value) as unknown;
    const data = isRecord(parsed) && Array.isArray(parsed.data) ? parsed.data : parsed;
    if (!Array.isArray(data)) {
      return [];
    }
    return data.map(parseModelListItem).filter((model) => model !== null);
  } catch {
    return [];
  }
}

function parseModelListItem(value: unknown): {
  readonly id: string;
  readonly endpointTypes: readonly string[];
} | null {
  if (typeof value === "string") {
    const id = value.trim();
    return id.length === 0 ? null : { id, endpointTypes: [] };
  }
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id)?.trim();
  if (!id) {
    return null;
  }
  return { id, endpointTypes: parseUnknownStringList(value.supported_endpoint_types) };
}

async function fetchTextWithTimeout(
  fetchImpl: DirectorApiProviderFetch,
  url: string,
  input: {
    readonly method: "GET" | "POST";
    readonly headers: Record<string, string>;
    readonly body?: string;
    readonly timeoutMs: number;
  },
): Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly body: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, input.timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: input.method,
      headers: input.headers,
      ...(input.body === undefined ? {} : { body: input.body }),
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function firstApiKey(value: string | undefined): string | undefined {
  return resolveApiKeys(value)[0];
}

function resolveApiKeys(...values: readonly (string | undefined)[]): string[] {
  return uniqueStringArray(
    values.flatMap((value) =>
      value === undefined
        ? []
        : value
            .split(/[,\n]/u)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
    ),
  );
}

async function planDirectorApiProviderKeysForModel(input: {
  readonly provider: DirectorApiProviderAdapter;
  readonly stored: StoredDirectorApiProvider | undefined;
  readonly model: string;
  readonly apiKeys: readonly string[];
  readonly timeoutMs: number;
  readonly fetchImpl: DirectorApiProviderFetch;
}): Promise<DirectorApiProviderPlannedApiKey[]> {
  const normalizedKeys = uniqueStringArray([...input.apiKeys]);
  if (
    input.provider.platform !== "memefast" ||
    normalizedKeys.length <= 1 ||
    input.model.trim().length === 0
  ) {
    return normalizedKeys.map((apiKey, index) =>
      createPlannedApiKey({
        apiKey,
        originalIndex: index,
        groupLabels: [],
        source: "unknown",
        visibility: "unknown",
      }),
    );
  }

  const modelEnableGroups = getDirectorApiProviderModelEnableGroups(input.provider, input.stored);
  const checks = await Promise.all(
    normalizedKeys.map(async (apiKey, index) => {
      const inventory = await readDirectorApiProviderModelInventory({
        provider: input.provider,
        apiKey,
        timeoutMs: input.timeoutMs,
        fetchImpl: input.fetchImpl,
      });
      const visibility =
        inventory.status === "visible"
          ? inventory.modelIds.has(input.model)
            ? "visible"
            : "invisible"
          : inventory.status;
      const groupLabels =
        visibility === "visible"
          ? inferDirectorApiProviderRoutingGroupLabels({
              model: input.model,
              visibleModelIds: inventory.modelIds,
              modelEnableGroups,
            })
          : [];

      return createPlannedApiKey({
        apiKey,
        originalIndex: index,
        groupLabels,
        source: groupLabels.length > 0 ? "model_visibility_inferred" : "unknown",
        visibility,
      });
    }),
  );

  const visible = checks.filter((item) => item.routingHint.visibility === "visible");
  const unknown = checks.filter((item) => item.routingHint.visibility === "unknown");
  const invisible = checks.filter((item) => item.routingHint.visibility === "invisible");
  return [...visible, ...unknown, ...invisible];
}

function createPlannedApiKey(input: {
  readonly apiKey: string;
  readonly originalIndex: number;
  readonly groupLabels: readonly string[];
  readonly source: DirectorApiProviderKeyRoutingHint["source"];
  readonly visibility: DirectorApiProviderModelVisibilityStatus;
}): DirectorApiProviderPlannedApiKey {
  const groupLabels = uniqueStringArray([...input.groupLabels]).sort((a, b) =>
    a.localeCompare(b, "zh-CN"),
  );
  return {
    apiKey: input.apiKey,
    originalIndex: input.originalIndex,
    routingHint: {
      groupLabels,
      groupKey: groupLabels.length > 0 ? `groups:${groupLabels.join("|")}` : `key:${input.apiKey}`,
      source: input.source,
      visibility: input.visibility,
    },
  };
}

async function readDirectorApiProviderModelInventory(input: {
  readonly provider: DirectorApiProviderAdapter;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly fetchImpl: DirectorApiProviderFetch;
}): Promise<{
  readonly status: DirectorApiProviderModelVisibilityStatus;
  readonly modelIds: ReadonlySet<string>;
}> {
  const cacheKey = buildDirectorApiProviderModelInventoryCacheKey(
    input.provider.baseUrl,
    input.apiKey,
  );
  const cached = memefastModelInventoryCache.get(cacheKey);
  if (
    cached !== undefined &&
    Date.now() - cached.checkedAt < MEMEFAST_MODEL_VISIBILITY_CACHE_TTL_MS
  ) {
    return {
      status: cached.status,
      modelIds: new Set(cached.modelIds),
    };
  }

  let status: DirectorApiProviderModelVisibilityStatus = "unknown";
  let modelIds = new Set<string>();
  try {
    const response = await fetchTextWithTimeout(
      input.fetchImpl,
      buildModelsEndpoint(input.provider.baseUrl),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
        },
        timeoutMs: input.timeoutMs,
      },
    );
    if (response.status === 401 || response.status === 403) {
      status = "invisible";
    } else if (!response.ok) {
      status = "unknown";
    } else {
      status = "visible";
      modelIds = new Set(parseModelListResponse(response.body).map((item) => item.id));
    }
  } catch {
    status = "unknown";
  }

  memefastModelInventoryCache.set(cacheKey, {
    checkedAt: Date.now(),
    status,
    modelIds: [...modelIds],
  });
  return { status, modelIds };
}

function buildDirectorApiProviderModelInventoryCacheKey(baseUrl: string, apiKey: string): string {
  return `${normalizeBaseUrl(baseUrl)}::${apiKey}`;
}

function getDirectorApiProviderModelEnableGroups(
  provider: DirectorApiProviderAdapter,
  stored: StoredDirectorApiProvider | undefined,
): Record<string, string[]> {
  const fromStored = cloneStringArrayRecord(stored?.modelEnableGroups);
  for (const metadata of provider.modelMetadata) {
    if (fromStored[metadata.model] !== undefined || metadata.enableGroups.length === 0) {
      continue;
    }
    fromStored[metadata.model] = [...metadata.enableGroups];
  }
  return fromStored;
}

function inferDirectorApiProviderRoutingGroupLabels(input: {
  readonly model: string;
  readonly visibleModelIds: ReadonlySet<string>;
  readonly modelEnableGroups: Readonly<Record<string, readonly string[]>>;
}): string[] {
  const targetGroups = input.modelEnableGroups[input.model] ?? [];
  if (targetGroups.length === 0) {
    return [];
  }

  const inferred = new Set<string>();
  for (const visibleModelId of input.visibleModelIds) {
    if (visibleModelId === input.model) {
      continue;
    }
    const groups = input.modelEnableGroups[visibleModelId];
    if (!Array.isArray(groups) || groups.length === 0) {
      continue;
    }
    for (const group of groups) {
      if (targetGroups.includes(group)) {
        inferred.add(group);
      }
    }
  }

  return targetGroups.filter((group) => inferred.has(group));
}

function reorderDirectorApiProviderRetryQueueByRoutingGroup(input: {
  readonly queue: DirectorApiProviderPlannedApiKey[];
  readonly cursorIndex: number;
  readonly usedGroups: ReadonlySet<string>;
  readonly blockedKeys: ReadonlySet<string>;
}): void {
  const nextIndex = input.cursorIndex + 1;
  if (nextIndex >= input.queue.length) {
    return;
  }
  const candidateIndex = input.queue.findIndex((item, index) => {
    if (index <= input.cursorIndex) {
      return false;
    }
    if (input.blockedKeys.has(item.apiKey)) {
      return false;
    }
    return !input.usedGroups.has(item.routingHint.groupKey);
  });
  if (candidateIndex < 0 || candidateIndex === nextIndex) {
    return;
  }
  const [candidate] = input.queue.splice(candidateIndex, 1);
  if (candidate !== undefined) {
    input.queue.splice(nextIndex, 0, candidate);
  }
}

function classifyTextCompletionKeyFailure(
  status: number,
  body: string | undefined,
): DirectorApiProviderKeyFailureClassification {
  if (status === 429) {
    return { retryable: true, blacklistKey: true, reason: "rate_limit" };
  }
  if (status === 401 || status === 403) {
    return { retryable: true, blacklistKey: true, reason: "auth" };
  }
  if (status >= 500 && isNoAvailableChannelProviderError(body)) {
    return { retryable: true, blacklistKey: true, reason: "service_unavailable" };
  }
  if (status >= 500 && isUpstreamOverloadProviderError(body)) {
    return { retryable: true, blacklistKey: false, reason: "service_unavailable" };
  }
  if (status >= 500) {
    return { retryable: true, blacklistKey: true, reason: "service_unavailable" };
  }
  if (
    (status === 400 || status === 404 || status === 422) &&
    isModelIncompatibleProviderError(body)
  ) {
    return { retryable: true, blacklistKey: true, reason: "model_incompatible" };
  }
  return {
    retryable: shouldRetryTextCompletionFailure(status, undefined),
    blacklistKey: false,
    reason: "unknown",
  };
}

function shouldRetryMediaProviderFailure(status: number | undefined, detail: unknown): boolean {
  if (status !== undefined) {
    const classification = classifyTextCompletionKeyFailure(status, String(detail ?? ""));
    return classification.retryable || shouldRetryTextCompletionFailure(status, undefined);
  }
  return shouldRetryTextCompletionFailure(undefined, detail);
}

function isModelIncompatibleProviderError(text: string | undefined): boolean {
  const normalized = (text ?? "").toLowerCase();
  return (
    normalized.includes("not support") ||
    normalized.includes("unsupported") ||
    normalized.includes("model_not_found") ||
    normalized.includes("model not found") ||
    normalized.includes("no such model") ||
    normalized.includes("unknown model") ||
    normalized.includes("does not exist") ||
    normalized.includes("模型不可用") ||
    normalized.includes("模型不存在") ||
    normalized.includes("模型未找到") ||
    normalized.includes("不支持该模型") ||
    normalized.includes("无此模型")
  );
}

function isNoAvailableChannelProviderError(text: string | undefined): boolean {
  const normalized = (text ?? "").toLowerCase();
  return (
    normalized.includes("无可用渠道") ||
    normalized.includes("no available channel") ||
    normalized.includes("no available channels") ||
    normalized.includes("no available distributor") ||
    normalized.includes("无可用分发")
  );
}

function isUpstreamOverloadProviderError(text: string | undefined): boolean {
  const normalized = (text ?? "").toLowerCase();
  return (
    normalized.includes("上游负载") ||
    normalized.includes("负载已饱和") ||
    normalized.includes("负载饱和") ||
    normalized.includes("overloaded")
  );
}

function buildModelsEndpoint(baseUrl: string): string {
  return /\/v\d+$/iu.test(baseUrl) ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
}

function normalizeProviderRootBaseUrl(baseUrl: string): string {
  return normalizeBaseUrl(baseUrl).replace(/\/v\d+$/iu, "");
}

function parseUnknownStringList(value: unknown): string[] {
  if (typeof value === "string") {
    return uniqueStringArray(value.split(","));
  }
  if (Array.isArray(value)) {
    return uniqueStringArray(value.filter(isString));
  }
  return [];
}

function cloneStringRecord(
  value: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  return value === undefined ? {} : { ...value };
}

function cloneStringArrayRecord(
  value: Readonly<Record<string, readonly string[]>> | undefined,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(value ?? {}).map(([key, entries]) => [key, uniqueStringArray([...entries])]),
  );
}

function resolveTextCompletionModels(
  provider: DirectorApiProviderAdapter,
  explicitModel: string | undefined,
  capabilityRoute: DirectorApiProviderTextCompletionCapabilityRoute | undefined,
): string[] {
  const explicit = explicitModel?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    return [explicit];
  }
  const abilityGroup = normalizeTextCompletionAbilityGroup(capabilityRoute?.abilityGroup);
  if (abilityGroup === "vision") {
    return uniqueStringArray([
      ...filterTextCompletionModelsByCapability(provider, "vision", [
        provider.defaultModels.vision,
        ...MEMEFAST_DEFAULT_VISION_MODELS,
      ]),
      ...filterTextCompletionModelsByCapability(provider, "text", [provider.defaultModels.text]),
    ]).slice(0, 4);
  }

  const preferredTextDefaults = uniqueStringArray([
    provider.defaultModels.text,
    ...MEMEFAST_DEFAULT_TEXT_MODELS,
  ]);
  return filterTextCompletionModelsByCapability(provider, "text", preferredTextDefaults).slice(
    0,
    4,
  );
}

function resolveTextCompletionRequiredProviderCapability(
  capabilityRoute: DirectorApiProviderTextCompletionCapabilityRoute | undefined,
): DirectorApiProviderCapability {
  return normalizeTextCompletionAbilityGroup(capabilityRoute?.abilityGroup) === "vision"
    ? "vision"
    : "text";
}

function normalizeTextCompletionAbilityGroup(
  abilityGroup: DirectorApiProviderTextCompletionAbilityGroup | undefined,
): "text" | "vision" {
  return abilityGroup === "vision" ? "vision" : "text";
}

function filterTextCompletionModelsByCapability(
  provider: DirectorApiProviderAdapter,
  requiredCapability: "text" | "vision",
  preferredModels: readonly string[],
): string[] {
  const modelMetadata = new Map(
    provider.modelMetadata.map((metadata) => [metadata.model, metadata]),
  );
  const candidateModels = uniqueStringArray([...preferredModels, ...provider.models]);
  return candidateModels.filter((model) => {
    if (!provider.models.includes(model)) {
      return false;
    }
    const capabilities =
      modelMetadata.get(model)?.capabilities ??
      classifyDirectorApiProviderModel(model, MEMEFAST_MODEL_ENDPOINT_TYPES[model]);
    if (!capabilities.includes(requiredCapability)) {
      return false;
    }
    return !isPureGenerationModelCapabilitySet(capabilities);
  });
}

function isPureGenerationModelCapabilitySet(
  capabilities: readonly DirectorApiProviderCapability[],
): boolean {
  const hasGeneration =
    capabilities.includes("image_generation") ||
    capabilities.includes("video_generation") ||
    capabilities.includes("audio_generation");
  return hasGeneration && !capabilities.includes("text") && !capabilities.includes("vision");
}

function createMemefastModelMetadata(
  models: readonly string[],
  metadata: Pick<
    StoredDirectorApiProvider,
    "modelEndpointTypes" | "modelTypes" | "modelTags" | "modelEnableGroups"
  > = {},
): DirectorApiProviderModelMetadata[] {
  return uniqueStringArray([...models]).map((model) => {
    const endpointTypes =
      metadata.modelEndpointTypes?.[model] ?? MEMEFAST_MODEL_ENDPOINT_TYPES[model] ?? [];
    const modelType = metadata.modelTypes?.[model];
    const modelTags = metadata.modelTags?.[model];
    const capabilities = classifyDirectorApiProviderModel(
      model,
      endpointTypes,
      modelType,
      modelTags,
    );
    const inferredModelType = inferMemefastModelType(capabilities);
    return {
      model,
      brandId: inferMemefastModelBrandId(model),
      modelFamily: inferMemefastModelFamily(model),
      ...(modelType === undefined
        ? inferredModelType === undefined
          ? {}
          : { modelType: inferredModelType }
        : { modelType }),
      tags: modelTags === undefined ? inferMemefastModelTags(model, capabilities) : [...modelTags],
      enableGroups:
        metadata.modelEnableGroups?.[model] === undefined
          ? inferMemefastEnableGroups(model)
          : [...metadata.modelEnableGroups[model]],
      endpointTypes,
      capabilities,
      imageRouteFamily: resolveDirectorApiProviderImageRouteFamily(endpointTypes, model),
      videoRouteFamily: resolveDirectorApiProviderVideoRouteFamily(endpointTypes, model),
    };
  });
}

function inferMemefastModelBrandId(modelName: string): string {
  for (const { pattern, brandId } of MEMEFAST_BRAND_PATTERNS) {
    if (pattern.test(modelName)) {
      return brandId;
    }
  }
  return "other";
}

function inferMemefastModelFamily(modelName: string): string {
  const name = modelName.toLowerCase();
  if (/gpt[-_]?image/iu.test(modelName)) {
    return "GPT Image";
  }
  if (name.startsWith("sora")) {
    return "Sora";
  }
  if (name.startsWith("gemini")) {
    return "Gemini";
  }
  if (name.startsWith("deepseek")) {
    return "DeepSeek";
  }
  if (name.startsWith("glm") || name.startsWith("chatglm")) {
    return "GLM";
  }
  if (name.includes("seedance")) {
    return "Seedance";
  }
  if (name.includes("seedream")) {
    return "Seedream";
  }
  if (name.startsWith("kling")) {
    return "Kling";
  }
  if (name.startsWith("wan")) {
    return "Wan";
  }
  if (name.startsWith("grok")) {
    return "Grok";
  }
  if (/omni[-_ ]?flash/iu.test(name)) {
    return "Omni Flash";
  }
  if (name.includes("hailuo")) {
    return "Hailuo";
  }
  if (name.startsWith("minimax")) {
    return "MiniMax";
  }
  if (name.startsWith("happyhorse")) {
    return "HappyHorse";
  }
  if (name.startsWith("claude")) {
    return "Claude";
  }
  if (name.startsWith("qwen")) {
    return "Qwen";
  }
  if (name.startsWith("veo")) {
    return "Veo";
  }
  if (name.startsWith("suno")) {
    return "Suno";
  }
  if (name.startsWith("pixverse")) {
    return "PixVerse";
  }
  const prefix = modelName.split(/[/-]/u).find((part) => part.trim().length > 0);
  return prefix ?? "Other";
}

function classifyDirectorApiProviderModel(
  modelName: string,
  endpointTypes: readonly string[] | undefined,
  modelType?: string,
  modelTags: readonly string[] = [],
): DirectorApiProviderCapability[] {
  const normalizedModelType = modelType?.trim();
  const normalizedTags = modelTags.join(",");
  if (
    isDirectorMemefastAudioModel(modelName) ||
    /音频|音乐|歌曲|歌词|配乐|suno|audio|music|lyrics/iu.test(normalizedTags) ||
    (endpointTypes ?? []).some((type) => /suno|音乐|歌词|audio|music|lyrics/iu.test(type))
  ) {
    return ["audio_generation"];
  }
  if (normalizedModelType === "文本") {
    const caps: DirectorApiProviderCapability[] = ["text"];
    if (
      /推理|思考|reason/iu.test(normalizedModelType) ||
      /thinking|reason|r1|v4-pro/iu.test(modelName)
    ) {
      caps.push("reasoning");
    }
    return caps;
  }
  if (normalizedModelType === "图像") {
    return ["image_generation"];
  }
  if (normalizedModelType === "音视频" || normalizedModelType === "视频") {
    return ["video_generation"];
  }
  if (normalizedModelType === "检索") {
    return ["embedding"];
  }

  const imageRoute = resolveDirectorApiProviderImageRouteFamily(endpointTypes, modelName);
  if (
    imageRoute === "kling_image" ||
    imageRoute === "openai_images" ||
    (imageRoute === "openai_chat" && isOpenAiChatImageModel(modelName, endpointTypes))
  ) {
    return ["image_generation"];
  }
  const videoRoute = resolveDirectorApiProviderVideoRouteFamily(endpointTypes, modelName);
  if (
    videoRoute !== "unknown" &&
    (!isAmbiguousOpenAiEndpointOnly(endpointTypes) || isVideoLikeModelName(modelName))
  ) {
    return ["video_generation"];
  }

  const name = modelName.toLowerCase();
  if (/vision|gemini|claude/iu.test(name)) {
    const caps: DirectorApiProviderCapability[] = ["text", "vision"];
    if (/thinking|reason/iu.test(name)) {
      caps.push("reasoning");
    }
    return caps;
  }
  if (/deepseek|glm|gpt|qwen|moonshot|yi|llama|mistral|text|chat/iu.test(name)) {
    const caps: DirectorApiProviderCapability[] = ["text"];
    if (/thinking|reason|r1/iu.test(name)) {
      caps.push("reasoning");
    }
    return caps;
  }
  if (/embed/iu.test(name)) {
    return ["embedding"];
  }
  return ["text"];
}

function isOpenAiChatImageModel(
  modelName: string,
  endpointTypes: readonly string[] | undefined,
): boolean {
  const name = modelName.toLowerCase();
  if (
    /gpt-image|sora.*image|image-preview|imagen|seedream/iu.test(name) ||
    (name.includes("gemini") && (name.includes("image") || name.includes("imagen")))
  ) {
    return true;
  }
  return (endpointTypes ?? []).some((type) => type === "gemini") && /image|imagen/iu.test(name);
}

function isAmbiguousOpenAiEndpointOnly(endpointTypes: readonly string[] | undefined): boolean {
  const normalized = uniqueStringArray(endpointTypes ?? []);
  return normalized.length === 1 && normalized[0] === "openai";
}

function isVideoLikeModelName(modelName: string): boolean {
  return /video|sora|veo|wan|kling|seedance|doubao|grok|omni[-_ ]?flash|runway|luma|hailuo|minimax|vidu|happyhorse|pixverse/iu.test(
    modelName,
  );
}

function inferMemefastModelType(
  capabilities: readonly DirectorApiProviderCapability[],
): string | undefined {
  if (capabilities.includes("video_generation")) {
    return "音视频";
  }
  if (capabilities.includes("audio_generation")) {
    return "音视频";
  }
  if (capabilities.includes("image_generation")) {
    return "图像";
  }
  if (capabilities.includes("embedding")) {
    return "检索";
  }
  if (capabilities.includes("text")) {
    return "文本";
  }
  return undefined;
}

function inferMemefastModelTags(
  model: string,
  capabilities: readonly DirectorApiProviderCapability[],
): string[] {
  const tags: string[] = [];
  if (capabilities.includes("text")) {
    tags.push("对话");
  }
  if (capabilities.includes("vision")) {
    tags.push("识图");
  }
  if (capabilities.includes("image_generation")) {
    tags.push("生图");
  }
  if (capabilities.includes("video_generation")) {
    tags.push("视频");
  }
  if (capabilities.includes("audio_generation")) {
    tags.push("音乐");
  }
  if (capabilities.includes("reasoning")) {
    tags.push("推理");
  }
  if (/function|tool/iu.test(model)) {
    tags.push("工具");
  }
  return uniqueStringArray(tags);
}

function inferMemefastEnableGroups(model: string): string[] {
  if (/doubao|seedance|seedream|sora|gpt-image|gemini|deepseek|glm|suno/iu.test(model)) {
    return ["default"];
  }
  return [];
}

function prioritizeModels(models: readonly string[], priorityModels: readonly string[]): string[] {
  const availableModels = uniqueStringArray([...models]);
  const availableModelSet = new Set(availableModels);
  const prioritySet = new Set(priorityModels);
  return [
    ...priorityModels.filter((model) => availableModelSet.has(model)),
    ...availableModels.filter((model) => !prioritySet.has(model)),
  ];
}

function shouldRetryTextCompletionFailure(status: number | undefined, error: unknown): boolean {
  if (status !== undefined) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }
  const message = toErrorMessage(error).toLowerCase();
  return /abort|timeout|timed? out|econnreset|econnrefused|enotfound|network|fetch failed/u.test(
    message,
  );
}

function uniqueStringArray(values: readonly string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  );
}

function uniqueCapabilities(
  values: readonly DirectorApiProviderCapability[],
): DirectorApiProviderCapability[] {
  return Array.from(new Set(values));
}

function maskSecret(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return "未设置";
  }
  if (value.length <= 8) {
    return "已设置";
  }
  return `${value.slice(0, 3)}...${value.slice(-4)}`;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}

function requireAbsoluteUrl(value: string | boolean): string {
  const normalized = requireString(value, "baseUrl");
  try {
    new URL(normalized);
  } catch {
    throw new Error("API provider baseUrl must be an absolute URL.");
  }
  return normalized;
}

function requireString(value: string | boolean, key: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`API provider setting ${key} requires a string value.`);
  }
  return value.trim();
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function createBlockedLocalWhisperPlan(
  providerId: LocalWhisperProviderId,
  reason: string,
): LocalWhisperPlanBlocked {
  return {
    ok: false,
    status: "blocked",
    providerId,
    reason,
    sideEffects: createFailClosedSpeechToTextSideEffects(),
  };
}

function createBlockedLocalWhisperRun(
  providerId: LocalWhisperProviderId,
  reason: string,
): LocalWhisperTranscriptionBlocked {
  return {
    ok: false,
    status: "blocked",
    providerId,
    reason,
    stdoutSummary: "",
    stderrSummary: "",
    sideEffects: createFailClosedSpeechToTextSideEffects(),
  };
}

function defaultLocalWhisperModel(providerId: LocalWhisperProviderId): string {
  return providerId === "local-faster-whisper" ? "large-v3" : "whisper-large-v3";
}

function allowedLocalWhisperModels(providerId: LocalWhisperProviderId): readonly string[] {
  return providerId === "local-faster-whisper"
    ? ["large-v3", "medium", "small", "base"]
    : ["whisper-large-v3", "whisper-medium", "whisper-small", "whisper-base"];
}

function createLocalWhisperArgs(input: {
  readonly providerId: LocalWhisperProviderId;
  readonly inputPath: string;
  readonly outputDir: string;
  readonly model: string;
  readonly language?: string;
}): readonly string[] {
  const args =
    input.providerId === "local-faster-whisper"
      ? [
          input.inputPath,
          "--model",
          input.model,
          "--output_dir",
          input.outputDir,
          "--output_format",
          "json",
        ]
      : [
          input.inputPath,
          "--model",
          input.model,
          "--output_dir",
          input.outputDir,
          "--output_format",
          "json",
        ];
  if (input.language !== undefined) {
    return [
      input.inputPath,
      "--model",
      input.model,
      "--language",
      input.language,
      "--output_dir",
      input.outputDir,
      "--output_format",
      "json",
    ];
  }
  return args;
}

function normalizeLocalWhisperTimeout(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 120_000;
  }
  return Math.min(Math.max(Math.trunc(value), 1_000), 900_000);
}

function isPathInsideRoots(path: string, roots: readonly string[]): boolean {
  if (!isAbsolute(path)) {
    return false;
  }
  const absolutePath = resolve(path);
  return roots.some((root) => {
    if (!isAbsolute(root)) {
      return false;
    }
    const absoluteRoot = resolve(root);
    const relation = relative(absoluteRoot, absolutePath);
    return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
  });
}

function summarizeCommandOutput(value: string | undefined): string {
  const normalized = (value ?? "").trim();
  return normalized.length <= 512 ? normalized : normalized.slice(0, 512);
}

function normalizeSpeechSynthesisText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/gu, "")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/\*([^*]+)\*/gu, "$1")
    .replace(/__([^_]+)__/gu, "$1")
    .replace(/_([^_]+)_/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/<[^>]+>/gu, "")
    .replace(/[ \t]+/gu, " ")
    .replace(/\s*\n+\s*/gu, " ")
    .trim();
}

function extractLocalWhisperTranscript(value: string | undefined): string {
  const normalized = (value ?? "").trim();
  if (normalized.length === 0) {
    return "";
  }
  const jsonStart = normalized.lastIndexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(normalized.slice(jsonStart)) as unknown;
      if (isRecord(parsed)) {
        const text = parsed.text;
        if (typeof text === "string") {
          return text.trim();
        }
      }
    } catch {
      // Fall through to plain output parsing.
    }
  }
  const lines = normalized
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? normalized;
}

function localWhisperErrorToChinese(value: string | undefined, exitCode: number): string {
  const text = (value ?? "").toLowerCase();
  if (/not found|enoent|command not found|no such file/u.test(text)) {
    return "本地 Whisper 没安装或命令不可用。";
  }
  if (/timeout|timed out/u.test(text)) {
    return "本地 Whisper 执行超时，已停止。";
  }
  if (/permission|eacces/u.test(text)) {
    return "本地 Whisper 没有权限读取输入音频或写入输出目录。";
  }
  return `本地 Whisper 执行失败，退出码 ${exitCode}。`;
}

function sanitizeId(value: string): string {
  const normalized = value
    .replace(/[^A-Za-z0-9_-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 120);
  return normalized.length > 0 ? normalized : "item";
}

function requireBoolean(value: string | boolean, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`API provider setting ${key} requires a boolean value.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isCapability(value: unknown): value is DirectorApiProviderCapability {
  return (
    value === "text" ||
    value === "vision" ||
    value === "function_calling" ||
    value === "image_generation" ||
    value === "video_generation" ||
    value === "audio_generation" ||
    value === "web_search" ||
    value === "reasoning" ||
    value === "embedding"
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
