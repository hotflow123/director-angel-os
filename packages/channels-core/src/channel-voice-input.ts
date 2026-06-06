export type ChannelVoiceInputSurface = "desktop" | "host-api" | "weixin" | (string & {});

export type ChannelVoiceSourceKind = "desktop-recording" | "file-ref" | "upload" | "weixin-voice";

export interface ChannelVoiceSource {
  readonly kind: ChannelVoiceSourceKind;
  readonly path?: string;
  readonly messageId?: string;
  readonly uploadId?: string;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
  readonly durationMs?: number;
  readonly sha256?: string;
}

export interface ChannelVoiceInputEnvelope {
  readonly schemaVersion: "director.channel-voice-input.v1";
  readonly surface: ChannelVoiceInputSurface;
  readonly channel: string;
  readonly messageId: string;
  readonly source: ChannelVoiceSource;
  readonly usesUnifiedConversationRuntime: true;
  readonly rawAudioLoaded: false;
  readonly providerSelectedByChannel: false;
  readonly metadata: {
    readonly normalizedAt: string;
  };
}

export interface ChannelVoiceInputEnvelopeInput {
  readonly surface: ChannelVoiceInputSurface;
  readonly channel: string;
  readonly messageId: string;
  readonly fileRef?: {
    readonly path: string;
    readonly mimeType?: string;
    readonly sizeBytes?: number;
    readonly durationMs?: number;
    readonly sha256?: string;
  };
  readonly weixinVoice?: {
    readonly messageId: string;
    readonly mimeType?: string;
    readonly sizeBytes?: number;
    readonly durationMs?: number;
    readonly sha256?: string;
  };
  readonly upload?: {
    readonly uploadId: string;
    readonly mimeType?: string;
    readonly sizeBytes?: number;
    readonly durationMs?: number;
    readonly sha256?: string;
  };
  readonly now?: string;
}

export interface ChannelVoiceTranscriptionPlan {
  readonly ok: true;
  readonly capabilityId: "audio.transcribe";
  readonly providerId: string;
  readonly usesUnifiedConversationRuntime: true;
  readonly runtimeInput: {
    readonly providerId: string;
    readonly source: ChannelVoiceSource;
    readonly language?: string;
    readonly model?: string;
  };
  readonly sideEffects: ChannelVoiceTranscriptionSideEffects;
}

export interface ChannelVoiceTranscriptionBlocked {
  readonly ok: false;
  readonly status: "blocked";
  readonly providerId: string;
  readonly reason: string;
  readonly sideEffects: ChannelVoiceTranscriptionSideEffects;
}

export type ChannelVoiceTranscriptionResult =
  | ChannelVoiceTranscriptionBlocked
  | ChannelVoiceTranscriptionPlan;

export interface ChannelVoiceTranscriptionSideEffects {
  readonly audioBytesRead: boolean;
  readonly rawAudioPersisted: boolean;
  readonly providerCredentialsUsed: boolean;
  readonly networkUsed: boolean;
  readonly microphoneAccessed: boolean;
}

export function createChannelVoiceInputEnvelope(
  input: ChannelVoiceInputEnvelopeInput,
): ChannelVoiceInputEnvelope {
  return {
    schemaVersion: "director.channel-voice-input.v1",
    surface: input.surface,
    channel: input.channel,
    messageId: input.messageId,
    source: resolveChannelVoiceSource(input),
    usesUnifiedConversationRuntime: true,
    rawAudioLoaded: false,
    providerSelectedByChannel: false,
    metadata: {
      normalizedAt: input.now ?? new Date().toISOString(),
    },
  };
}

export function planChannelVoiceTranscription(
  envelope: ChannelVoiceInputEnvelope,
  input: {
    readonly providerId: string;
    readonly language?: string;
    readonly model?: string;
  },
): ChannelVoiceTranscriptionResult {
  const sourceIssue = validateChannelVoiceSource(envelope.source);
  if (sourceIssue !== undefined) {
    return {
      ok: false,
      status: "blocked",
      providerId: input.providerId,
      reason: sourceIssue,
      sideEffects: createFailClosedChannelVoiceSideEffects(),
    };
  }
  return {
    ok: true,
    capabilityId: "audio.transcribe",
    providerId: input.providerId,
    usesUnifiedConversationRuntime: true,
    runtimeInput: {
      providerId: input.providerId,
      source: envelope.source,
      ...(input.language === undefined ? {} : { language: input.language }),
      ...(input.model === undefined ? {} : { model: input.model }),
    },
    sideEffects: createFailClosedChannelVoiceSideEffects(),
  };
}

function resolveChannelVoiceSource(input: ChannelVoiceInputEnvelopeInput): ChannelVoiceSource {
  if (input.weixinVoice !== undefined) {
    return {
      kind: "weixin-voice",
      messageId: input.weixinVoice.messageId,
      ...(input.weixinVoice.mimeType === undefined ? {} : { mimeType: input.weixinVoice.mimeType }),
      ...(input.weixinVoice.sizeBytes === undefined
        ? {}
        : { sizeBytes: input.weixinVoice.sizeBytes }),
      ...(input.weixinVoice.durationMs === undefined
        ? {}
        : { durationMs: input.weixinVoice.durationMs }),
      ...(input.weixinVoice.sha256 === undefined ? {} : { sha256: input.weixinVoice.sha256 }),
    };
  }
  if (input.upload !== undefined) {
    return {
      kind: "upload",
      messageId: input.upload.uploadId,
      uploadId: input.upload.uploadId,
      ...(input.upload.mimeType === undefined ? {} : { mimeType: input.upload.mimeType }),
      ...(input.upload.sizeBytes === undefined ? {} : { sizeBytes: input.upload.sizeBytes }),
      ...(input.upload.durationMs === undefined ? {} : { durationMs: input.upload.durationMs }),
      ...(input.upload.sha256 === undefined ? {} : { sha256: input.upload.sha256 }),
    };
  }
  if (input.fileRef !== undefined) {
    return {
      kind: input.surface === "desktop" ? "desktop-recording" : "file-ref",
      path: input.fileRef.path,
      messageId: input.messageId,
      ...(input.fileRef.mimeType === undefined ? {} : { mimeType: input.fileRef.mimeType }),
      ...(input.fileRef.sizeBytes === undefined ? {} : { sizeBytes: input.fileRef.sizeBytes }),
      ...(input.fileRef.durationMs === undefined ? {} : { durationMs: input.fileRef.durationMs }),
      ...(input.fileRef.sha256 === undefined ? {} : { sha256: input.fileRef.sha256 }),
    };
  }
  return {
    kind: "file-ref",
    messageId: input.messageId,
  };
}

function validateChannelVoiceSource(source: ChannelVoiceSource): string | undefined {
  if (typeof source.sizeBytes === "number" && source.sizeBytes <= 0) {
    return "语音音频为空，未启动语音转文字。";
  }
  if (source.kind === "weixin-voice" && readNonEmptyString(source.messageId) === undefined) {
    return "微信语音消息缺少 messageId，未启动语音转文字。";
  }
  if (
    (source.kind === "desktop-recording" || source.kind === "file-ref") &&
    readNonEmptyString(source.path) === undefined
  ) {
    return "语音文件路径为空，未启动语音转文字。";
  }
  if (source.kind === "upload" && readNonEmptyString(source.uploadId) === undefined) {
    return "上传语音缺少 uploadId，未启动语音转文字。";
  }
  return undefined;
}

function createFailClosedChannelVoiceSideEffects(): ChannelVoiceTranscriptionSideEffects {
  return {
    audioBytesRead: false,
    rawAudioPersisted: false,
    providerCredentialsUsed: false,
    networkUsed: false,
    microphoneAccessed: false,
  };
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
