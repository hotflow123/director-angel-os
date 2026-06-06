import { Buffer } from "node:buffer";

import {
  createMediaAnalysisExtensionManifest,
  createMediaUnderstandingExtensionManifest,
} from "@hotflow/agent-os-extensions";

import type {
  ExternalToolArtifact,
  ExternalToolHandlerInvokeOutput,
  ExternalToolHandlerInvokeRequest,
  ExternalToolRegistration,
} from "./external-tools.js";
import { createExternalToolManifestFromAgentOsExtensionManifest } from "./external-tools.js";

export interface MediaUnderstandingArtifactInput {
  readonly id?: string;
  readonly kind?: string;
  readonly mimeType?: string;
  readonly byteLength?: number;
  readonly width?: number;
  readonly height?: number;
  readonly durationMs?: number;
  readonly sampleRateHz?: number;
  readonly channels?: number;
  readonly path?: string;
  readonly url?: string;
  readonly dataUrl?: string;
  readonly base64?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MediaUnderstandingObservation {
  readonly id: string;
  readonly summary: string;
  readonly confidence: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MediaUnderstandingRunnerOutput {
  readonly status: "error" | "success";
  readonly summary: string;
  readonly media: {
    readonly id: string;
    readonly kind: string;
    readonly mimeType: string;
    readonly byteLength?: number;
    readonly dimensions?: {
      readonly width: number;
      readonly height: number;
    };
    readonly durationMs?: number;
    readonly sampleRateHz?: number;
    readonly channels?: number;
    readonly path?: string;
    readonly url?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
  readonly observations: readonly MediaUnderstandingObservation[];
  readonly sandbox?: Readonly<Record<string, unknown>>;
}

interface MediaContainerMetadata {
  readonly container: "flac" | "mp4" | "wav" | "webm";
  readonly mimeType: string;
  readonly byteLength: number;
  readonly durationMs?: number;
  readonly sampleRateHz?: number;
  readonly channels?: number;
  readonly bitsPerSample?: number;
  readonly totalSamples?: number;
  readonly timescale?: number;
  readonly majorBrand?: string;
  readonly codecs?: readonly string[];
}

const MAX_INLINE_MEDIA_BYTES = 16 * 1024 * 1024;
const MEDIA_ANALYSIS_EXTENSION_ID = "media-analysis.local";
const MEDIA_ANALYSIS_PROVIDER_ID = "media-analysis";

export function createBuiltInMediaUnderstandingExternalToolRegistration(): ExternalToolRegistration {
  const manifest = createExternalToolManifestFromAgentOsExtensionManifest(
    createMediaUnderstandingExtensionManifest(),
  );
  return {
    manifest,
    check: ({ nowMs }) => ({
      status: "ready",
      summary: "Built-in media-understanding metadata runner is ready.",
      checkedAtMs: nowMs,
      metadata: {
        agentOsExtensionId: manifest.id,
        providerId: manifest.providerId ?? manifest.id,
        runnerMode: "local-container-metadata",
      },
    }),
    invoke: invokeBuiltInMediaUnderstanding,
  };
}

export function createBuiltInMediaAnalysisProviderExternalToolRegistration(): ExternalToolRegistration {
  const manifest = createExternalToolManifestFromAgentOsExtensionManifest(
    createMediaAnalysisExtensionManifest({
      id: MEDIA_ANALYSIS_EXTENSION_ID,
      providerId: MEDIA_ANALYSIS_PROVIDER_ID,
    }),
  );
  return {
    manifest,
    check: ({ nowMs }) => ({
      status: "ready",
      summary: "Built-in media-analysis provider runner dry-run path is ready.",
      checkedAtMs: nowMs,
      metadata: {
        agentOsExtensionId: manifest.id,
        providerId: manifest.providerId ?? MEDIA_ANALYSIS_PROVIDER_ID,
        runnerMode: "local-command-dry-run",
        runnerKind: "local-media-analysis-provider-runner",
        providerCredentialsUsed: false,
        networkUsed: false,
        liveRunnerStarted: false,
        semanticTranscription: "unsupported",
      },
    }),
    sandboxCommandExecution: { enabled: true },
  };
}

function invokeBuiltInMediaUnderstanding(
  request: ExternalToolHandlerInvokeRequest,
): ExternalToolHandlerInvokeOutput {
  const artifact = readMediaUnderstandingArtifactInput(request.args);
  if (artifact === undefined) {
    return {
      ok: false,
      content: "media-understanding requires an artifact object.",
      error: "media-understanding-artifact-required",
      output: {
        status: "error",
        summary: "media-understanding requires an artifact object.",
        observations: [],
      },
    };
  }

  const parsedBytes = parseInlineMediaBytes(artifact);
  if (parsedBytes.error !== undefined) {
    return {
      ok: false,
      content: parsedBytes.error,
      error: "media-understanding-inline-media-invalid",
      output: {
        status: "error",
        summary: parsedBytes.error,
        observations: [],
      },
    };
  }

  const header =
    parsedBytes.bytes === undefined ? undefined : inspectMediaHeader(parsedBytes.bytes);
  const container =
    parsedBytes.bytes === undefined ? undefined : inspectMediaContainer(parsedBytes.bytes);
  const mimeType =
    artifact.mimeType ??
    parsedBytes.mimeType ??
    container?.mimeType ??
    header?.mimeType ??
    inferMimeType(artifact);
  const kind = normalizeMediaKind(artifact.kind, mimeType, request.capability.id);
  const dimensions = readDimensions(artifact, header);
  const byteLength = artifact.byteLength ?? parsedBytes.bytes?.byteLength ?? header?.byteLength;
  const metadata = mergeMediaMetadata(artifact.metadata, container);
  const durationMs = artifact.durationMs ?? container?.durationMs;
  const sampleRateHz = artifact.sampleRateHz ?? container?.sampleRateHz;
  const channels = artifact.channels ?? container?.channels;
  const media = {
    id: normalizeArtifactId(artifact.id),
    kind,
    mimeType,
    ...(byteLength === undefined ? {} : { byteLength }),
    ...(dimensions === undefined ? {} : { dimensions }),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(sampleRateHz === undefined ? {} : { sampleRateHz }),
    ...(channels === undefined ? {} : { channels }),
    ...(artifact.path === undefined ? {} : { path: artifact.path }),
    ...(artifact.url === undefined ? {} : { url: artifact.url }),
    ...(metadata === undefined ? {} : { metadata }),
  };
  const observations = createMediaUnderstandingObservations({
    kind,
    mimeType,
    byteLength,
    dimensions,
    container,
    artifact,
  });
  const output: MediaUnderstandingRunnerOutput = {
    status: "success",
    summary: createMediaUnderstandingSummary(kind, mimeType, observations),
    media,
    observations,
    sandbox: {
      backend: request.metadata?.agentOsSandboxBackend ?? "readonly",
      networkPolicy: "none",
      mode: "metadata-only",
      pathContentRead: false,
    },
  };
  return {
    ok: true,
    content: output.summary,
    output,
    artifacts: [createMediaUnderstandingTraceArtifact(media)],
    metadata: {
      mediaUnderstandingRunner: {
        providerId: request.manifest.providerId ?? request.manifest.id,
        mode: container === undefined ? "local-metadata" : "local-container-metadata",
        ...(container === undefined ? {} : { container: container.container }),
        inlineBytesInspected: parsedBytes.bytes?.byteLength ?? 0,
        pathContentRead: false,
      },
    },
  };
}

function readMediaUnderstandingArtifactInput(
  args: Readonly<Record<string, unknown>> | undefined,
): MediaUnderstandingArtifactInput | undefined {
  const artifact = args?.artifact;
  if (!isRecord(artifact)) {
    return undefined;
  }
  const id = readOptionalString(artifact, "id");
  const kind = readOptionalString(artifact, "kind");
  const mimeType =
    readOptionalString(artifact, "mimeType") ?? readOptionalString(artifact, "mime_type");
  const byteLength =
    readOptionalNumber(artifact, "byteLength") ?? readOptionalNumber(artifact, "byte_length");
  const width = readOptionalNumber(artifact, "width");
  const height = readOptionalNumber(artifact, "height");
  const durationMs =
    readOptionalNumber(artifact, "durationMs") ?? readOptionalNumber(artifact, "duration_ms");
  const sampleRateHz =
    readOptionalNumber(artifact, "sampleRateHz") ?? readOptionalNumber(artifact, "sample_rate_hz");
  const channels = readOptionalNumber(artifact, "channels");
  const path = readOptionalString(artifact, "path");
  const url = readOptionalString(artifact, "url");
  const dataUrl =
    readOptionalString(artifact, "dataUrl") ?? readOptionalString(artifact, "data_url");
  const base64 = readOptionalString(artifact, "base64");
  const metadata = readOptionalRecord(artifact, "metadata");
  return {
    ...(id === undefined ? {} : { id }),
    ...(kind === undefined ? {} : { kind }),
    ...(mimeType === undefined ? {} : { mimeType }),
    ...(byteLength === undefined ? {} : { byteLength }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(sampleRateHz === undefined ? {} : { sampleRateHz }),
    ...(channels === undefined ? {} : { channels }),
    ...(path === undefined ? {} : { path }),
    ...(url === undefined ? {} : { url }),
    ...(dataUrl === undefined ? {} : { dataUrl }),
    ...(base64 === undefined ? {} : { base64 }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function parseInlineMediaBytes(input: MediaUnderstandingArtifactInput): {
  readonly bytes?: Buffer;
  readonly mimeType?: string;
  readonly error?: string;
} {
  if (input.dataUrl !== undefined) {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/u.exec(input.dataUrl.trim());
    if (match === null) {
      return { error: "media-understanding dataUrl must be a base64 data URL." };
    }
    const mimeType = match[1];
    const base64 = match[2];
    if (mimeType === undefined || base64 === undefined) {
      return { error: "media-understanding dataUrl must include mime type and base64 data." };
    }
    return decodeBase64Media(base64, mimeType);
  }
  if (input.base64 !== undefined) {
    return decodeBase64Media(input.base64, input.mimeType);
  }
  return {};
}

function decodeBase64Media(
  value: string,
  mimeType: string | undefined,
): {
  readonly bytes?: Buffer;
  readonly mimeType?: string;
  readonly error?: string;
} {
  const normalized = value.replace(/\s+/gu, "");
  if (normalized.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(normalized)) {
    return { error: "media-understanding inline media must be valid base64." };
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.byteLength > MAX_INLINE_MEDIA_BYTES) {
    return { error: "media-understanding inline media exceeds the 16 MiB limit." };
  }
  return {
    bytes,
    ...(mimeType === undefined ? {} : { mimeType }),
  };
}

function inspectMediaHeader(bytes: Buffer):
  | {
      readonly mimeType: string;
      readonly byteLength: number;
      readonly width?: number;
      readonly height?: number;
    }
  | undefined {
  if (bytes.byteLength >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return {
      mimeType: "image/png",
      byteLength: bytes.byteLength,
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }
  if (bytes.byteLength >= 10 && bytes.subarray(0, 6).toString("ascii").startsWith("GIF")) {
    return {
      mimeType: "image/gif",
      byteLength: bytes.byteLength,
      width: bytes.readUInt16LE(6),
      height: bytes.readUInt16LE(8),
    };
  }
  if (
    bytes.byteLength >= 30 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return inspectWebpHeader(bytes);
  }
  if (bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return inspectJpegHeader(bytes);
  }
  return undefined;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EBML_SIGNATURE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const FLAC_SIGNATURE = Buffer.from("fLaC", "ascii");

function inspectMediaContainer(bytes: Buffer): MediaContainerMetadata | undefined {
  if (bytes.byteLength >= 42 && bytes.subarray(0, 4).equals(FLAC_SIGNATURE)) {
    return inspectFlacContainer(bytes);
  }
  if (
    bytes.byteLength >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WAVE"
  ) {
    return inspectWavContainer(bytes);
  }
  if (bytes.byteLength >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    return inspectMp4Container(bytes);
  }
  if (bytes.byteLength >= 4 && bytes.subarray(0, 4).equals(EBML_SIGNATURE)) {
    return {
      container: "webm",
      mimeType: "video/webm",
      byteLength: bytes.byteLength,
    };
  }
  return undefined;
}

function inspectMp4Container(bytes: Buffer): MediaContainerMetadata {
  let offset = 0;
  let majorBrand: string | undefined;
  let timescale: number | undefined;
  let duration: number | undefined;
  const codecs: string[] = [];
  while (offset + 8 <= bytes.byteLength) {
    const size = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (size < 8 || offset + size > bytes.byteLength) {
      break;
    }
    const payload = bytes.subarray(offset + 8, offset + size);
    if (type === "ftyp" && payload.byteLength >= 4) {
      majorBrand = payload.subarray(0, 4).toString("ascii");
    }
    if (type === "moov") {
      const movieHeader = findMp4Box(payload, "mvhd");
      if (movieHeader !== undefined) {
        const parsed = parseMp4MovieHeader(movieHeader);
        timescale = parsed.timescale;
        duration = parsed.duration;
      }
      codecs.push(...collectMp4CodecHints(payload));
    }
    offset += size;
  }
  return {
    container: "mp4",
    mimeType: "video/mp4",
    byteLength: bytes.byteLength,
    ...(duration === undefined || timescale === undefined || timescale === 0
      ? {}
      : { durationMs: Math.round((duration / timescale) * 1000) }),
    ...(timescale === undefined ? {} : { timescale }),
    ...(majorBrand === undefined ? {} : { majorBrand }),
    ...(codecs.length === 0 ? {} : { codecs: [...new Set(codecs)] }),
  };
}

function findMp4Box(bytes: Buffer, wantedType: string): Buffer | undefined {
  let offset = 0;
  while (offset + 8 <= bytes.byteLength) {
    const size = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (size < 8 || offset + size > bytes.byteLength) {
      return undefined;
    }
    const payload = bytes.subarray(offset + 8, offset + size);
    if (type === wantedType) {
      return payload;
    }
    offset += size;
  }
  return undefined;
}

function parseMp4MovieHeader(payload: Buffer): {
  readonly timescale?: number;
  readonly duration?: number;
} {
  const version = payload[0] ?? 0;
  if (version === 1 && payload.byteLength >= 32) {
    return {
      timescale: payload.readUInt32BE(20),
      duration: Number(payload.readBigUInt64BE(24)),
    };
  }
  if (payload.byteLength >= 20) {
    return {
      timescale: payload.readUInt32BE(12),
      duration: payload.readUInt32BE(16),
    };
  }
  return {};
}

function collectMp4CodecHints(bytes: Buffer): readonly string[] {
  const hints = new Set<string>();
  const text = bytes.toString("latin1");
  for (const codec of ["avc1", "hev1", "hvc1", "mp4a", "vp09", "av01"]) {
    if (text.includes(codec)) {
      hints.add(codec);
    }
  }
  return [...hints];
}

function inspectWavContainer(bytes: Buffer): MediaContainerMetadata | undefined {
  let offset = 12;
  let channels: number | undefined;
  let sampleRateHz: number | undefined;
  let bitsPerSample: number | undefined;
  let dataBytes: number | undefined;
  while (offset + 8 <= bytes.byteLength) {
    const type = bytes.subarray(offset, offset + 4).toString("ascii");
    const size = bytes.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;
    const nextOffset = payloadOffset + size + (size % 2);
    if (payloadOffset + size > bytes.byteLength) {
      break;
    }
    if (type === "fmt " && size >= 16) {
      channels = bytes.readUInt16LE(payloadOffset + 2);
      sampleRateHz = bytes.readUInt32LE(payloadOffset + 4);
      bitsPerSample = bytes.readUInt16LE(payloadOffset + 14);
    }
    if (type === "data") {
      dataBytes = size;
    }
    offset = nextOffset;
  }
  const bytesPerSecond =
    sampleRateHz === undefined || channels === undefined || bitsPerSample === undefined
      ? undefined
      : sampleRateHz * channels * (bitsPerSample / 8);
  return {
    container: "wav",
    mimeType: "audio/wav",
    byteLength: bytes.byteLength,
    ...(dataBytes === undefined || bytesPerSecond === undefined || bytesPerSecond <= 0
      ? {}
      : { durationMs: Math.round((dataBytes / bytesPerSecond) * 1000) }),
    ...(sampleRateHz === undefined ? {} : { sampleRateHz }),
    ...(channels === undefined ? {} : { channels }),
    ...(bitsPerSample === undefined ? {} : { bitsPerSample }),
  };
}

function inspectFlacContainer(bytes: Buffer): MediaContainerMetadata | undefined {
  let offset = 4;
  while (offset + 4 <= bytes.byteLength) {
    const header = bytes[offset] ?? 0;
    const blockType = header & 0x7f;
    const blockLength = bytes.readUIntBE(offset + 1, 3);
    const payloadOffset = offset + 4;
    if (payloadOffset + blockLength > bytes.byteLength) {
      break;
    }
    if (blockType === 0 && blockLength >= 34) {
      const payload = bytes.subarray(payloadOffset, payloadOffset + blockLength);
      const streamInfo = payload.readBigUInt64BE(10);
      const sampleRateHz = Number((streamInfo >> 44n) & 0xfffffn);
      const channels = Number((streamInfo >> 41n) & 0x7n) + 1;
      const bitsPerSample = Number((streamInfo >> 36n) & 0x1fn) + 1;
      const totalSamples = Number(streamInfo & 0xfffffffffn);
      return {
        container: "flac",
        mimeType: "audio/flac",
        byteLength: bytes.byteLength,
        ...(sampleRateHz === 0 ? {} : { sampleRateHz }),
        channels,
        bitsPerSample,
        totalSamples,
        ...(sampleRateHz === 0 || totalSamples === 0
          ? {}
          : { durationMs: Math.round((totalSamples / sampleRateHz) * 1000) }),
      };
    }
    offset = payloadOffset + blockLength;
    if ((header & 0x80) !== 0) {
      break;
    }
  }
  return {
    container: "flac",
    mimeType: "audio/flac",
    byteLength: bytes.byteLength,
  };
}

function inspectJpegHeader(bytes: Buffer):
  | {
      readonly mimeType: string;
      readonly byteLength: number;
      readonly width?: number;
      readonly height?: number;
    }
  | undefined {
  let offset = 2;
  while (offset + 9 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      return { mimeType: "image/jpeg", byteLength: bytes.byteLength };
    }
    const marker = bytes[offset + 1];
    const segmentLength = bytes.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.byteLength) {
      return { mimeType: "image/jpeg", byteLength: bytes.byteLength };
    }
    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf
    ) {
      return {
        mimeType: "image/jpeg",
        byteLength: bytes.byteLength,
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + segmentLength;
  }
  return { mimeType: "image/jpeg", byteLength: bytes.byteLength };
}

function inspectWebpHeader(bytes: Buffer):
  | {
      readonly mimeType: string;
      readonly byteLength: number;
      readonly width?: number;
      readonly height?: number;
    }
  | undefined {
  const chunk = bytes.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X" && bytes.byteLength >= 30) {
    return {
      mimeType: "image/webp",
      byteLength: bytes.byteLength,
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8 " && bytes.byteLength >= 30) {
    return {
      mimeType: "image/webp",
      byteLength: bytes.byteLength,
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  return { mimeType: "image/webp", byteLength: bytes.byteLength };
}

function normalizeMediaKind(
  kind: string | undefined,
  mimeType: string,
  capabilityId: string,
): string {
  if (kind === "image" || kind === "video" || kind === "audio") {
    return kind;
  }
  if (mimeType.startsWith("image/") || capabilityId === "media.understand_image") {
    return "image";
  }
  if (mimeType.startsWith("video/") || capabilityId === "media.understand_video") {
    return "video";
  }
  if (mimeType.startsWith("audio/") || capabilityId === "media.understand_audio") {
    return "audio";
  }
  return "artifact";
}

function inferMimeType(input: MediaUnderstandingArtifactInput): string {
  if (input.path !== undefined) {
    const lower = input.path.toLowerCase();
    if (lower.endsWith(".png")) {
      return "image/png";
    }
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
      return "image/jpeg";
    }
    if (lower.endsWith(".gif")) {
      return "image/gif";
    }
    if (lower.endsWith(".webp")) {
      return "image/webp";
    }
    if (lower.endsWith(".mp4")) {
      return "video/mp4";
    }
    if (lower.endsWith(".webm")) {
      return "video/webm";
    }
    if (lower.endsWith(".flac")) {
      return "audio/flac";
    }
    if (lower.endsWith(".mp3")) {
      return "audio/mpeg";
    }
    if (lower.endsWith(".wav")) {
      return "audio/wav";
    }
  }
  return "application/octet-stream";
}

function readDimensions(
  artifact: MediaUnderstandingArtifactInput,
  header:
    | {
        readonly width?: number;
        readonly height?: number;
      }
    | undefined,
):
  | {
      readonly width: number;
      readonly height: number;
    }
  | undefined {
  const width = artifact.width ?? header?.width;
  const height = artifact.height ?? header?.height;
  if (width === undefined || height === undefined) {
    return undefined;
  }
  return { width, height };
}

function createMediaUnderstandingObservations(input: {
  readonly kind: string;
  readonly mimeType: string;
  readonly byteLength: number | undefined;
  readonly dimensions: { readonly width: number; readonly height: number } | undefined;
  readonly container: MediaContainerMetadata | undefined;
  readonly artifact: MediaUnderstandingArtifactInput;
}): readonly MediaUnderstandingObservation[] {
  const durationMs = input.artifact.durationMs ?? input.container?.durationMs;
  return [
    {
      id: "media.format",
      summary: `${formatMimeType(input.mimeType)} ${input.kind} artifact`,
      confidence: input.mimeType === "application/octet-stream" ? 0.35 : 1,
      metadata: { mimeType: input.mimeType, kind: input.kind },
    },
    ...(input.byteLength === undefined
      ? []
      : [
          {
            id: "media.size",
            summary: `${input.byteLength} bytes`,
            confidence: 1,
            metadata: { byteLength: input.byteLength },
          },
        ]),
    ...(input.dimensions === undefined
      ? []
      : [
          {
            id: "media.dimensions",
            summary: `${input.dimensions.width} x ${input.dimensions.height} pixels`,
            confidence: 1,
            metadata: input.dimensions,
          },
        ]),
    ...(input.container === undefined
      ? []
      : [
          {
            id: "media.container",
            summary: `${formatContainerName(input.container.container)} container`,
            confidence: 1,
            metadata: {
              container: input.container.container,
              mimeType: input.container.mimeType,
            },
          },
        ]),
    ...(durationMs === undefined
      ? []
      : [
          {
            id: "media.duration",
            summary: `${durationMs} ms`,
            confidence: input.container?.durationMs === undefined ? 0.9 : 0.95,
            metadata: { durationMs },
          },
        ]),
    ...(input.container?.sampleRateHz === undefined || input.container.channels === undefined
      ? []
      : [
          {
            id: "media.audio",
            summary: `${input.container.channels} channel(s) at ${input.container.sampleRateHz} Hz`,
            confidence: 1,
            metadata: {
              channels: input.container.channels,
              sampleRateHz: input.container.sampleRateHz,
              ...(input.container.bitsPerSample === undefined
                ? {}
                : { bitsPerSample: input.container.bitsPerSample }),
            },
          },
        ]),
    {
      id: "runner.boundary",
      summary: "Local metadata-only media runner; file paths are not opened by this runner.",
      confidence: 1,
      metadata: { pathContentRead: false },
    },
  ];
}

function mergeMediaMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
  container: MediaContainerMetadata | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (container === undefined) {
    return metadata;
  }
  return {
    ...(metadata ?? {}),
    container: container.container,
    ...(container.timescale === undefined ? {} : { timescale: container.timescale }),
    ...(container.majorBrand === undefined ? {} : { majorBrand: container.majorBrand }),
    ...(container.codecs === undefined ? {} : { codecs: container.codecs }),
    ...(container.bitsPerSample === undefined ? {} : { bitsPerSample: container.bitsPerSample }),
    ...(container.totalSamples === undefined ? {} : { totalSamples: container.totalSamples }),
  };
}

function createMediaUnderstandingSummary(
  kind: string,
  mimeType: string,
  observations: readonly MediaUnderstandingObservation[],
): string {
  return `Inspected ${formatMimeType(mimeType)} ${kind} artifact with ${observations.length} observation(s).`;
}

function formatMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "PNG";
    case "image/jpeg":
      return "JPEG";
    case "image/gif":
      return "GIF";
    case "image/webp":
      return "WebP";
    case "video/mp4":
      return "MP4";
    case "video/webm":
      return "WebM";
    case "audio/mpeg":
      return "MP3";
    case "audio/flac":
      return "FLAC";
    case "audio/wav":
      return "WAV";
    default:
      return mimeType;
  }
}

function formatContainerName(container: MediaContainerMetadata["container"]): string {
  switch (container) {
    case "flac":
      return "FLAC";
    case "mp4":
      return "MP4";
    case "wav":
      return "WAV";
    case "webm":
      return "WebM";
  }
}

function createMediaUnderstandingTraceArtifact(
  media: MediaUnderstandingRunnerOutput["media"],
): ExternalToolArtifact {
  return {
    id: `${media.id}:metadata`,
    kind: "media-understanding-metadata",
    ...(media.path === undefined ? {} : { path: media.path }),
    ...(media.url === undefined ? {} : { url: media.url }),
    metadata: {
      kind: media.kind,
      mimeType: media.mimeType,
      ...(media.byteLength === undefined ? {} : { byteLength: media.byteLength }),
      ...(media.dimensions === undefined ? {} : { dimensions: media.dimensions }),
    },
  };
}

function normalizeArtifactId(id: string | undefined): string {
  const normalized = id?.trim();
  return normalized === undefined || normalized.length === 0 ? "media-artifact" : normalized;
}

function readOptionalString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = record[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function readOptionalNumber(
  record: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

function readOptionalRecord(
  record: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
