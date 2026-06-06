import {
  type ConversationRuntimeMediaAuthorizationCostTier,
  type ConversationRuntimeMediaEvidenceRef,
  createMediaEvidenceRef,
} from "./learning-artifact.js";

export type ConversationRuntimeDiscoveredMediaKind =
  | "image"
  | "video"
  | "audio"
  | "poster"
  | "blob"
  | "unknown";

export interface ConversationRuntimeDiscoveredMediaAsset {
  readonly id: string;
  readonly kind: ConversationRuntimeDiscoveredMediaKind;
  readonly sourceRef: string;
  readonly sourceUrl?: string;
  readonly poster?: string;
  readonly mimeType?: string;
  readonly durationSeconds?: number;
  readonly durationMs?: number;
  readonly width?: number;
  readonly height?: number;
  readonly origin: string;
  readonly scope: "primary" | "supplemental";
  readonly evidenceStatus: "listed_only";
  readonly isBlobReference: boolean;
}

export interface ConversationRuntimeMediaInventory {
  readonly schemaVersion: "conversation-runtime.media-inventory.v1";
  readonly sourceUrl?: string;
  readonly assetCount: number;
  readonly imageCount: number;
  readonly videoCount: number;
  readonly audioCount: number;
  readonly posterCount: number;
  readonly blobCount: number;
  readonly unknownCount: number;
  readonly assets: readonly ConversationRuntimeDiscoveredMediaAsset[];
}

export interface CreateConversationRuntimeMediaInventoryInput {
  readonly body?: string;
  readonly structuredContent?: unknown;
  readonly sourceSnapshot?: unknown;
  readonly extractionReport?: unknown;
  readonly sourceUrl?: string;
}

export interface ConversationRuntimeMediaInventoryBudgetSummary {
  readonly tokenLimit: number;
  readonly fileCountLimit: number;
  readonly videoMinuteLimit: number;
  readonly audioMinuteLimit: number;
  readonly estimatedCostTier: ConversationRuntimeMediaAuthorizationCostTier;
}

interface DiscoveredMediaCandidate {
  readonly kind?: ConversationRuntimeDiscoveredMediaKind;
  readonly sourceRef: string;
  readonly poster?: string;
  readonly mimeType?: string;
  readonly durationSeconds?: number;
  readonly durationMs?: number;
  readonly width?: number;
  readonly height?: number;
  readonly origin: string;
  readonly scope?: "primary" | "supplemental";
}

const IMAGE_EXT_RE = /\.(?:png|jpe?g|webp|gif|avif|bmp|svg)(?:[?#].*)?$/iu;
const VIDEO_EXT_RE = /\.(?:mp4|mov|m4v|webm|mkv|avi|m3u8)(?:[?#].*)?$/iu;
const AUDIO_EXT_RE = /\.(?:mp3|wav|m4a|aac|flac|ogg|opus)(?:[?#].*)?$/iu;
const MARKDOWN_LINK_RE = /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/giu;
const PLAIN_URL_RE = /\b(?:https?:\/\/|blob:https?:\/\/)[^\s<>"'）)]+/giu;
const POSTER_ASSIGNMENT_RE = /\bposter\s*=\s*(["']?)([^"'\s<>)]+)\1/giu;

export function createConversationRuntimeMediaInventory(
  input: CreateConversationRuntimeMediaInventoryInput,
): ConversationRuntimeMediaInventory {
  const candidates: DiscoveredMediaCandidate[] = [];
  if (typeof input.body === "string" && input.body.length > 0) {
    candidates.push(...collectMediaCandidatesFromText(input.body, "body"));
  }
  candidates.push(
    ...collectMediaCandidatesFromStructured(input.structuredContent, "structured_content"),
  );
  candidates.push(...collectMediaCandidatesFromStructured(input.sourceSnapshot, "source_snapshot"));
  candidates.push(
    ...collectMediaCandidatesFromStructured(input.extractionReport, "extraction_report"),
  );

  const assets = dedupeMediaCandidates(candidates).map((candidate, index) =>
    createDiscoveredMediaAsset(candidate, index, input.sourceUrl),
  );
  const counts = countInventoryAssets(assets);
  return {
    schemaVersion: "conversation-runtime.media-inventory.v1",
    ...(input.sourceUrl === undefined ? {} : { sourceUrl: input.sourceUrl }),
    assetCount: assets.length,
    imageCount: counts.image,
    videoCount: counts.video,
    audioCount: counts.audio,
    posterCount: counts.poster,
    blobCount: counts.blob,
    unknownCount: counts.unknown,
    assets,
  };
}

export function createMediaEvidenceRefsFromInventory(
  inventory: ConversationRuntimeMediaInventory,
  input: {
    readonly evidencePrefix?: string;
    readonly observedAtMs?: number;
  } = {},
): readonly ConversationRuntimeMediaEvidenceRef[] {
  return inventory.assets.map((asset, index) =>
    createMediaEvidenceRef({
      id: `${input.evidencePrefix ?? "media-evidence"}-${index + 1}`,
      sourceRef: asset.sourceRef,
      status: "listed_only",
      publishable: false,
      ...(input.observedAtMs === undefined ? {} : { observedAtMs: input.observedAtMs }),
      metadata: {
        mediaType: asset.kind === "poster" ? "image" : asset.kind === "blob" ? "video" : asset.kind,
        inventoryKind: asset.kind,
        origin: asset.origin,
        scope: asset.scope,
        ...(asset.sourceUrl === undefined ? {} : { sourceUrl: asset.sourceUrl }),
        ...(asset.poster === undefined ? {} : { poster: asset.poster }),
        ...(asset.mimeType === undefined ? {} : { mimeType: asset.mimeType }),
        ...(asset.durationSeconds === undefined ? {} : { durationSeconds: asset.durationSeconds }),
        ...(asset.durationMs === undefined ? {} : { durationMs: asset.durationMs }),
        ...(asset.width === undefined ? {} : { width: asset.width }),
        ...(asset.height === undefined ? {} : { height: asset.height }),
        ...(asset.isBlobReference ? { isBlobReference: true } : {}),
      },
    }),
  );
}

export function createMediaInventoryBudgetSummary(
  inventory: ConversationRuntimeMediaInventory,
): ConversationRuntimeMediaInventoryBudgetSummary {
  let videoSeconds = 0;
  let audioSeconds = 0;
  for (const asset of inventory.assets) {
    const duration =
      asset.durationSeconds ??
      (asset.durationMs === undefined ? undefined : asset.durationMs / 1000);
    if (duration === undefined || duration <= 0) {
      continue;
    }
    if (asset.kind === "video" || asset.kind === "blob") {
      videoSeconds += duration;
    } else if (asset.kind === "audio") {
      audioSeconds += duration;
    }
  }
  const estimatedCostTier = estimateInventoryCostTier(inventory);
  return {
    tokenLimit:
      inventory.imageCount * 4_000 +
      inventory.posterCount * 1_200 +
      inventory.videoCount * 24_000 +
      inventory.blobCount * 12_000 +
      inventory.audioCount * 8_000 +
      inventory.unknownCount * 5_000,
    fileCountLimit: inventory.assetCount,
    videoMinuteLimit: Math.max(inventory.videoCount, Math.ceil(videoSeconds / 60)),
    audioMinuteLimit: Math.max(inventory.audioCount, Math.ceil(audioSeconds / 60)),
    estimatedCostTier,
  };
}

function collectMediaCandidatesFromText(
  text: string,
  origin: string,
): readonly DiscoveredMediaCandidate[] {
  const candidates: DiscoveredMediaCandidate[] = [];
  for (const match of text.matchAll(MARKDOWN_LINK_RE)) {
    const label = match[1] ?? "";
    const sourceRef = cleanMediaUrl(match[2] ?? "");
    const kind = inferMediaKind(sourceRef, label);
    if (sourceRef.length > 0 && kind !== "unknown") {
      candidates.push({ sourceRef, kind, origin, scope: "primary" });
    }
  }
  for (const match of text.matchAll(POSTER_ASSIGNMENT_RE)) {
    const sourceRef = cleanMediaUrl(match[2] ?? "");
    if (sourceRef.length > 0) {
      candidates.push({ sourceRef, kind: "poster", origin, scope: "supplemental" });
    }
  }
  for (const match of text.matchAll(PLAIN_URL_RE)) {
    const sourceRef = cleanMediaUrl(match[0] ?? "");
    const kind = inferMediaKind(sourceRef);
    if (sourceRef.length > 0 && kind !== "unknown") {
      candidates.push({ sourceRef, kind, origin, scope: "primary" });
    }
  }
  return candidates;
}

function collectMediaCandidatesFromStructured(
  value: unknown,
  origin: string,
): readonly DiscoveredMediaCandidate[] {
  const candidates: DiscoveredMediaCandidate[] = [];
  visitStructuredMedia(value, origin, [], candidates);
  return candidates;
}

function visitStructuredMedia(
  value: unknown,
  origin: string,
  path: readonly string[],
  candidates: DiscoveredMediaCandidate[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitStructuredMedia(item, origin, path, candidates);
    }
    return;
  }
  if (!isRecord(value)) {
    if (typeof value === "string") {
      const sourceRef = cleanMediaUrl(value);
      const kind = inferMediaKind(sourceRef, path.at(-1) ?? "");
      if (sourceRef.length > 0 && kind !== "unknown" && isMediaPath(path)) {
        candidates.push({
          sourceRef,
          kind,
          origin: `${origin}.${path.join(".")}`,
          scope: "primary",
        });
      }
    }
    return;
  }

  const typeHint = readStringFromRecord(value, ["type", "kind", "mediaType", "mimeType"]);
  const url = readStringFromRecord(value, ["url", "src", "href", "sourceRef", "source"]);
  if (url !== undefined && isMediaPath(path)) {
    const sourceRef = cleanMediaUrl(url);
    if (sourceRef.length > 0) {
      const poster = readStringFromRecord(value, ["poster", "thumbnail", "cover"]);
      const mimeType = readStringFromRecord(value, ["mimeType", "contentType"]);
      const durationSeconds = readNumberFromRecord(value, ["durationSeconds", "duration"]);
      const durationMs = readNumberFromRecord(value, ["durationMs"]);
      const width = readNumberFromRecord(value, ["width"]);
      const height = readNumberFromRecord(value, ["height"]);
      candidates.push({
        sourceRef,
        kind: inferMediaKind(sourceRef, typeHint),
        ...(poster === undefined ? {} : { poster }),
        ...(mimeType === undefined ? {} : { mimeType }),
        ...(durationSeconds === undefined ? {} : { durationSeconds }),
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height }),
        origin: `${origin}.${path.join(".") || "root"}`,
        scope: "primary",
      });
    }
  }

  const poster = readStringFromRecord(value, ["poster", "thumbnail", "cover"]);
  if (poster !== undefined && isMediaPath([...path, "poster"])) {
    const sourceRef = cleanMediaUrl(poster);
    if (sourceRef.length > 0) {
      candidates.push({
        sourceRef,
        kind: "poster",
        origin: `${origin}.${[...path, "poster"].join(".")}`,
        scope: "supplemental",
      });
    }
  }

  for (const [key, child] of Object.entries(value)) {
    visitStructuredMedia(child, origin, [...path, key], candidates);
  }
}

function dedupeMediaCandidates(
  candidates: readonly DiscoveredMediaCandidate[],
): readonly DiscoveredMediaCandidate[] {
  const deduped = new Map<string, DiscoveredMediaCandidate>();
  for (const candidate of candidates) {
    const sourceRef = cleanMediaUrl(candidate.sourceRef);
    if (sourceRef.length === 0) {
      continue;
    }
    const kind = candidate.kind ?? inferMediaKind(sourceRef, candidate.mimeType);
    const key = sourceRef.toLocaleLowerCase();
    const previous = deduped.get(key);
    if (previous === undefined) {
      deduped.set(key, { ...candidate, sourceRef, kind });
    } else if (shouldReplaceMediaCandidate(previous, { ...candidate, sourceRef, kind })) {
      deduped.set(key, { ...candidate, sourceRef, kind });
    }
  }
  return [...deduped.values()];
}

function shouldReplaceMediaCandidate(
  previous: DiscoveredMediaCandidate,
  next: DiscoveredMediaCandidate,
): boolean {
  if (previous.kind === "poster" && next.kind !== "poster") {
    return false;
  }
  if (previous.kind === "unknown" && next.kind !== "unknown") {
    return true;
  }
  if (previous.scope === "supplemental" && next.scope === "primary" && next.kind !== "image") {
    return true;
  }
  return false;
}

function createDiscoveredMediaAsset(
  candidate: DiscoveredMediaCandidate,
  index: number,
  sourceUrl: string | undefined,
): ConversationRuntimeDiscoveredMediaAsset {
  const kind = normalizeMediaKind(
    candidate.kind ?? inferMediaKind(candidate.sourceRef, candidate.mimeType),
  );
  return {
    id: `media-${index + 1}`,
    kind,
    sourceRef: candidate.sourceRef,
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    ...(candidate.poster === undefined ? {} : { poster: candidate.poster }),
    ...(candidate.mimeType === undefined ? {} : { mimeType: candidate.mimeType }),
    ...(candidate.durationSeconds === undefined
      ? {}
      : { durationSeconds: candidate.durationSeconds }),
    ...(candidate.durationMs === undefined ? {} : { durationMs: candidate.durationMs }),
    ...(candidate.width === undefined ? {} : { width: candidate.width }),
    ...(candidate.height === undefined ? {} : { height: candidate.height }),
    origin: candidate.origin,
    scope: candidate.scope ?? "primary",
    evidenceStatus: "listed_only",
    isBlobReference: candidate.sourceRef.toLocaleLowerCase().startsWith("blob:"),
  };
}

function countInventoryAssets(assets: readonly ConversationRuntimeDiscoveredMediaAsset[]): {
  readonly image: number;
  readonly video: number;
  readonly audio: number;
  readonly poster: number;
  readonly blob: number;
  readonly unknown: number;
} {
  let image = 0;
  let video = 0;
  let audio = 0;
  let poster = 0;
  let blob = 0;
  let unknown = 0;
  for (const asset of assets) {
    if (asset.kind === "image") {
      image += 1;
    } else if (asset.kind === "video") {
      video += 1;
    } else if (asset.kind === "audio") {
      audio += 1;
    } else if (asset.kind === "poster") {
      poster += 1;
    } else if (asset.kind === "blob") {
      blob += 1;
      video += 1;
    } else {
      unknown += 1;
    }
  }
  return { image, video, audio, poster, blob, unknown };
}

function inferMediaKind(sourceRef: string, hint?: string): ConversationRuntimeDiscoveredMediaKind {
  const normalizedHint = hint?.toLocaleLowerCase() ?? "";
  if (normalizedHint.includes("poster") || normalizedHint.includes("thumbnail")) {
    return "poster";
  }
  if (normalizedHint.includes("image") || normalizedHint.startsWith("img")) {
    return "image";
  }
  if (normalizedHint.includes("video")) {
    return sourceRef.toLocaleLowerCase().startsWith("blob:") ? "blob" : "video";
  }
  if (normalizedHint.includes("audio")) {
    return "audio";
  }
  const normalizedSource = sourceRef.toLocaleLowerCase();
  if (normalizedSource.startsWith("blob:")) {
    return "blob";
  }
  if (IMAGE_EXT_RE.test(normalizedSource)) {
    return "image";
  }
  if (VIDEO_EXT_RE.test(normalizedSource)) {
    return "video";
  }
  if (AUDIO_EXT_RE.test(normalizedSource)) {
    return "audio";
  }
  return "unknown";
}

function normalizeMediaKind(
  kind: ConversationRuntimeDiscoveredMediaKind,
): ConversationRuntimeDiscoveredMediaKind {
  return kind;
}

function estimateInventoryCostTier(
  inventory: ConversationRuntimeMediaInventory,
): ConversationRuntimeMediaAuthorizationCostTier {
  if (inventory.assetCount === 0) {
    return "none";
  }
  if (inventory.videoCount + inventory.audioCount >= 3 || inventory.assetCount >= 8) {
    return "high";
  }
  if (inventory.videoCount > 0 || inventory.audioCount > 0 || inventory.assetCount >= 4) {
    return "medium";
  }
  return "low";
}

function isMediaPath(path: readonly string[]): boolean {
  if (path.length === 0) {
    return false;
  }
  return path.some((part) =>
    /^(media|assets?|images?|imgs?|videos?|audios?|poster|thumbnail|cover|src|url|href|blocks?|orderedBlocks|children|items|structuredContent|sourceSnapshot|source_snapshot|snapshot)$/iu.test(
      part,
    ),
  );
}

function readStringFromRecord(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string" && item.trim().length > 0) {
      return item.trim();
    }
  }
  return undefined;
}

function readNumberFromRecord(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const item = value[key];
    if (typeof item === "number" && Number.isFinite(item)) {
      return item;
    }
  }
  return undefined;
}

function cleanMediaUrl(value: string): string {
  return value.trim().replace(/[.,;，。；]+$/u, "");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
