import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type {
  ConversationRuntimeAutomationAction,
  ConversationRuntimeAutomationPolicyDecision,
} from "./automation-policy.js";
import type {
  ConversationRuntimeMemoryConfidence,
  ConversationRuntimeMemoryPrivacy,
  ConversationRuntimeSourceKind,
} from "./memory-evidence.js";
import {
  isLearningCollectionAdviceQuestion,
  isReadOnlyLearningEvidenceFollowup,
} from "./turn-policy.js";
import type { ConversationRuntimeResult } from "./types.js";

export type ConversationRuntimeLearningArtifactStatus =
  | "collecting"
  | "candidate"
  | "pending_confirmation"
  | "accepted"
  | "published"
  | "rejected"
  | "quarantined";

export type ConversationRuntimeLearningRoleRelevance = "high" | "medium" | "low" | "off_scope";

export type ConversationRuntimeMediaEvidenceStatus =
  | "listed_only"
  | "browser_visible"
  | "ocr_extracted"
  | "vision_analyzed"
  | "blocked";

export type ConversationRuntimeMediaAuthorizationMode =
  | "text_only"
  | "media_inventory"
  | "low_cost"
  | "deep_multimodal";

export type ConversationRuntimeMediaAuthorizationCostTier = "none" | "low" | "medium" | "high";

export interface ConversationRuntimeMediaAuthorizationOption {
  readonly mode: ConversationRuntimeMediaAuthorizationMode;
  readonly label: string;
  readonly description: string;
  readonly requiresUserAuthorization: boolean;
  readonly estimatedTokenBudget: number;
  readonly estimatedCostTier: ConversationRuntimeMediaAuthorizationCostTier;
}

export interface ConversationRuntimeMediaAuthorizationRequest {
  readonly required: boolean;
  readonly reason: string;
  readonly assetCount: number;
  readonly imageCount: number;
  readonly videoCount: number;
  readonly audioCount: number;
  readonly unknownCount: number;
  readonly defaultMode: ConversationRuntimeMediaAuthorizationMode;
  readonly recommendedMode: ConversationRuntimeMediaAuthorizationMode;
  readonly estimatedTokenBudget: {
    readonly mediaInventory: number;
    readonly lowCost: number;
    readonly deepMultimodal: number;
  };
  readonly budget: {
    readonly tokenLimit: number;
    readonly fileCountLimit: number;
    readonly videoMinuteLimit: number;
    readonly audioMinuteLimit: number;
    readonly estimatedCostTier: ConversationRuntimeMediaAuthorizationCostTier;
  };
  readonly estimatedCostTier: ConversationRuntimeMediaAuthorizationCostTier;
  readonly privacy: ConversationRuntimeMemoryPrivacy;
  readonly options: readonly ConversationRuntimeMediaAuthorizationOption[];
}

export interface ConversationRuntimeLearningRoleScope {
  readonly roleName: string;
  readonly domain: string;
  readonly responsibilityTags: readonly string[];
}

export interface ConversationRuntimeLearningClassification {
  readonly domain: string;
  readonly topic: string;
  readonly tags: readonly string[];
  readonly useCases: readonly string[];
  readonly roleRelevance: ConversationRuntimeLearningRoleRelevance;
}

export interface ConversationRuntimeMediaEvidenceRef {
  readonly id: string;
  readonly sourceRef: string;
  readonly status: ConversationRuntimeMediaEvidenceStatus;
  readonly realVisualUnderstanding: boolean;
  readonly confidence: ConversationRuntimeMemoryConfidence;
  readonly publishable: boolean;
  readonly privacy: ConversationRuntimeMemoryPrivacy;
  readonly observedAtMs: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateConversationRuntimeMediaEvidenceRefInput {
  readonly id: string;
  readonly sourceRef: string;
  readonly status: ConversationRuntimeMediaEvidenceStatus;
  readonly confidence?: ConversationRuntimeMemoryConfidence;
  readonly publishable?: boolean;
  readonly privacy?: ConversationRuntimeMemoryPrivacy;
  readonly observedAtMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeLearningArtifact {
  readonly artifactId: string;
  readonly sessionKey: string;
  readonly turnRunId: string;
  readonly sourceSurface: "desktop" | "weixin" | "host" | (string & {});
  readonly angelRoleId?: string;
  readonly roleScope: ConversationRuntimeLearningRoleScope;
  readonly sourceKind:
    | ConversationRuntimeSourceKind
    | "browser-page"
    | "image"
    | "video"
    | "tool-result"
    | "chat";
  readonly sourceRef: string;
  readonly status: ConversationRuntimeLearningArtifactStatus;
  readonly evidenceRefs: readonly string[];
  readonly mediaEvidenceRefs: readonly ConversationRuntimeMediaEvidenceRef[];
  readonly confidence: ConversationRuntimeMemoryConfidence;
  readonly publishable: boolean;
  readonly privacy: ConversationRuntimeMemoryPrivacy;
  readonly classification?: ConversationRuntimeLearningClassification;
  readonly qualityGates: readonly string[];
  readonly pendingConfirmationId?: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateConversationRuntimeLearningArtifactInput {
  readonly artifactId: string;
  readonly sessionKey: string;
  readonly turnRunId: string;
  readonly sourceSurface: "desktop" | "weixin" | "host" | (string & {});
  readonly angelRoleId?: string;
  readonly roleScope: ConversationRuntimeLearningRoleScope;
  readonly sourceKind: ConversationRuntimeLearningArtifact["sourceKind"];
  readonly sourceRef: string;
  readonly status?: ConversationRuntimeLearningArtifactStatus;
  readonly evidenceRefs?: readonly string[];
  readonly mediaEvidenceRefs?: readonly ConversationRuntimeMediaEvidenceRef[];
  readonly confidence?: ConversationRuntimeMemoryConfidence;
  readonly publishable?: boolean;
  readonly privacy?: ConversationRuntimeMemoryPrivacy;
  readonly classification?: ConversationRuntimeLearningClassification;
  readonly pendingConfirmationId?: string;
  readonly observedAtMs?: number;
  readonly updatedAtMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ConversationRuntimeLearningConfirmationStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "expired"
  | "cancelled";

export interface ConversationRuntimeLearningConfirmation {
  readonly confirmationId: string;
  readonly sessionKey: string;
  readonly artifactId: string;
  readonly candidateIds: readonly string[];
  readonly conversationTurnId?: string;
  readonly status: ConversationRuntimeLearningConfirmationStatus;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly acceptedByMessageId?: string;
  readonly decisionText?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateConversationRuntimeLearningConfirmationInput {
  readonly confirmationId: string;
  readonly sessionKey: string;
  readonly artifactId: string;
  readonly candidateIds?: readonly string[];
  readonly conversationTurnId?: string;
  readonly status?: ConversationRuntimeLearningConfirmationStatus;
  readonly createdAtMs?: number;
  readonly expiresAtMs?: number;
  readonly ttlMs?: number;
  readonly acceptedByMessageId?: string;
  readonly decisionText?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ConversationRuntimeLearningConfirmationDecision =
  | {
      readonly kind: "accept" | "reject";
      readonly confirmationId: string;
      readonly artifactId: string;
      readonly candidateIds: readonly string[];
      readonly acceptedByMessageId?: string;
      readonly decisionText: string;
    }
  | {
      readonly kind: "expired";
      readonly confirmationId: string;
      readonly artifactId: string;
    }
  | {
      readonly kind: "none";
      readonly reason?: "ordinal-out-of-range";
    };

export interface ResolveConversationRuntimeLearningConfirmationDecisionInput {
  readonly text: string;
  readonly sessionKey: string;
  readonly pending: readonly ConversationRuntimeLearningConfirmation[];
  readonly nowMs?: number;
  readonly messageId?: string;
}

export interface ConversationRuntimeLearningConfirmationResolution {
  readonly decision: ConversationRuntimeLearningConfirmationDecision;
  readonly artifact?: ConversationRuntimeLearningArtifact;
  readonly confirmation?: ConversationRuntimeLearningConfirmation;
}

export interface ConversationRuntimeLearningArtifactStore {
  readonly upsertArtifact: (
    artifact: ConversationRuntimeLearningArtifact,
  ) => ConversationRuntimeLearningArtifact;
  readonly readArtifact: (artifactId: string) => ConversationRuntimeLearningArtifact | undefined;
  readonly listArtifacts: (input?: {
    readonly sessionKey?: string;
    readonly status?: ConversationRuntimeLearningArtifactStatus;
  }) => readonly ConversationRuntimeLearningArtifact[];
  readonly upsertConfirmation: (
    confirmation: ConversationRuntimeLearningConfirmation,
  ) => ConversationRuntimeLearningConfirmation;
  readonly readConfirmation: (
    confirmationId: string,
  ) => ConversationRuntimeLearningConfirmation | undefined;
  readonly listPendingConfirmations: (
    sessionKey: string,
    nowMs?: number,
  ) => readonly ConversationRuntimeLearningConfirmation[];
  readonly resolvePendingConfirmation: (input: {
    readonly text: string;
    readonly sessionKey: string;
    readonly nowMs?: number;
    readonly messageId?: string;
  }) => ConversationRuntimeLearningConfirmationResolution;
}

export interface CreateConversationRuntimeLearningArtifactStoreOptions {
  readonly nowMs?: () => number;
  readonly seed?: ConversationRuntimeLearningArtifactStoreDocument;
  readonly persist?: (document: ConversationRuntimeLearningArtifactStoreDocument) => void;
}

export interface FileConversationRuntimeLearningArtifactStoreOptions {
  readonly path: string;
  readonly nowMs?: () => number;
}

export interface ConversationRuntimeLearningArtifactStoreDocument {
  readonly schemaVersion: "conversation-runtime.learning-artifacts.v1";
  readonly artifacts: readonly ConversationRuntimeLearningArtifact[];
  readonly confirmations: readonly ConversationRuntimeLearningConfirmation[];
}

export interface CreatePendingConversationRuntimeLearningArtifactFromResultInput {
  readonly store: ConversationRuntimeLearningArtifactStore;
  readonly sessionKey: string;
  readonly turnRunId: string;
  readonly sourceSurface: ConversationRuntimeLearningArtifact["sourceSurface"];
  readonly sourceKind: ConversationRuntimeLearningArtifact["sourceKind"];
  readonly sourceRef: string;
  readonly result: unknown;
  readonly roleScope?: ConversationRuntimeLearningRoleScope;
  readonly angelRoleId?: string;
  readonly observedAtMs?: number;
  readonly confirmationTtlMs?: number;
  readonly automationAction?: ConversationRuntimeAutomationAction;
  readonly automationDecision?: ConversationRuntimeAutomationPolicyDecision;
}

export interface CreatePendingConversationRuntimeLearningArtifactFromResultResult {
  readonly created: boolean;
  readonly artifact?: ConversationRuntimeLearningArtifact;
  readonly confirmation?: ConversationRuntimeLearningConfirmation;
  readonly reason?: string;
}

export interface CreateSourceAccessLimitedLearningArtifactFromRuntimeResultInput {
  readonly store: ConversationRuntimeLearningArtifactStore;
  readonly sessionKey: string;
  readonly sourceSurface: ConversationRuntimeLearningArtifact["sourceSurface"];
  readonly sourceKind: ConversationRuntimeLearningArtifact["sourceKind"];
  readonly sourceRef?: string;
  readonly result: ConversationRuntimeResult;
  readonly observedAtMs?: number;
}

const DEFAULT_CONFIRMATION_TTL_MS = 30 * 60 * 1000;

function normalizeLearningSessionKey(sessionKey: string): string {
  return sessionKey.trim();
}

export function createMediaEvidenceRef(
  input: CreateConversationRuntimeMediaEvidenceRefInput,
): ConversationRuntimeMediaEvidenceRef {
  const realVisualUnderstanding =
    input.status === "ocr_extracted" || input.status === "vision_analyzed";
  return {
    id: input.id,
    sourceRef: input.sourceRef,
    status: input.status,
    realVisualUnderstanding,
    confidence:
      input.confidence ??
      (input.status === "vision_analyzed"
        ? "high"
        : input.status === "ocr_extracted" || input.status === "browser_visible"
          ? "medium"
          : "low"),
    publishable: input.publishable ?? realVisualUnderstanding,
    privacy: input.privacy ?? "pii_potential",
    observedAtMs: input.observedAtMs ?? Date.now(),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

export function createMediaAuthorizationRequest(
  mediaEvidenceRefs: readonly ConversationRuntimeMediaEvidenceRef[],
): ConversationRuntimeMediaAuthorizationRequest | undefined {
  const unresolved = mediaEvidenceRefs.filter((evidence) => !evidence.realVisualUnderstanding);
  if (unresolved.length === 0) {
    return undefined;
  }
  const counts = countMediaEvidenceTypes(unresolved);
  const estimatedTokenBudget = estimateMediaAuthorizationTokenBudget(counts);
  const estimatedCostTier = estimateMediaAuthorizationCostTier(counts);
  const budget = estimateMediaAuthorizationBudget({
    mediaEvidenceRefs: unresolved,
    estimatedTokenBudget,
    estimatedCostTier,
  });
  return {
    required: true,
    reason: "media_requires_user_authorization_and_budget_before_understanding",
    assetCount: unresolved.length,
    imageCount: counts.image,
    videoCount: counts.video,
    audioCount: counts.audio,
    unknownCount: counts.unknown,
    defaultMode: "media_inventory",
    recommendedMode: estimatedCostTier === "high" ? "media_inventory" : "low_cost",
    estimatedTokenBudget,
    budget,
    estimatedCostTier,
    privacy: inferMediaAuthorizationPrivacy(unresolved),
    options: [
      {
        mode: "text_only",
        label: "只学习正文",
        description: "不解析图片、视频或音频，媒体内容不会作为已学经验入库。",
        requiresUserAuthorization: false,
        estimatedTokenBudget: 0,
        estimatedCostTier: "none",
      },
      {
        mode: "media_inventory",
        label: "只记录媒体清单",
        description: "保留媒体链接、尺寸和来源，用于后续人工确认或追加处理。",
        requiresUserAuthorization: false,
        estimatedTokenBudget: estimatedTokenBudget.mediaInventory,
        estimatedCostTier: "none",
      },
      {
        mode: "low_cost",
        label: "低成本精读重点媒体",
        description: "对图片做 OCR/视觉摘要，对视频优先抽关键帧或转录，再回填证据。",
        requiresUserAuthorization: true,
        estimatedTokenBudget: estimatedTokenBudget.lowCost,
        estimatedCostTier,
      },
      {
        mode: "deep_multimodal",
        label: "深度视频/多模态理解",
        description: "对图片、视频和音频做更完整理解，适合高价值来源但成本更高。",
        requiresUserAuthorization: true,
        estimatedTokenBudget: estimatedTokenBudget.deepMultimodal,
        estimatedCostTier: promoteMediaAuthorizationCostTier(estimatedCostTier),
      },
    ],
  };
}

function countMediaEvidenceTypes(
  mediaEvidenceRefs: readonly ConversationRuntimeMediaEvidenceRef[],
): {
  readonly image: number;
  readonly video: number;
  readonly audio: number;
  readonly unknown: number;
} {
  let image = 0;
  let video = 0;
  let audio = 0;
  let unknown = 0;
  for (const evidence of mediaEvidenceRefs) {
    const mediaType = inferMediaEvidenceType(evidence);
    if (mediaType === "image") {
      image += 1;
    } else if (mediaType === "video") {
      video += 1;
    } else if (mediaType === "audio") {
      audio += 1;
    } else {
      unknown += 1;
    }
  }
  return { image, video, audio, unknown };
}

function inferMediaEvidenceType(
  evidence: ConversationRuntimeMediaEvidenceRef,
): "image" | "video" | "audio" | "unknown" {
  const explicitType =
    readRecordString(evidence.metadata, "mediaType") ??
    readRecordString(evidence.metadata, "type") ??
    readRecordString(evidence.metadata, "kind");
  const normalizedExplicitType = explicitType?.toLocaleLowerCase();
  if (
    normalizedExplicitType === "image" ||
    normalizedExplicitType === "video" ||
    normalizedExplicitType === "audio"
  ) {
    return normalizedExplicitType;
  }
  const sourceRef = evidence.sourceRef.toLocaleLowerCase();
  if (/\.(?:png|jpe?g|webp|gif|avif|bmp|svg)(?:[?#].*)?$/u.test(sourceRef)) {
    return "image";
  }
  if (/\.(?:mp4|mov|m4v|webm|mkv|avi)(?:[?#].*)?$/u.test(sourceRef)) {
    return "video";
  }
  if (/\.(?:mp3|wav|m4a|aac|flac|ogg)(?:[?#].*)?$/u.test(sourceRef)) {
    return "audio";
  }
  if (sourceRef.includes("video") || sourceRef.startsWith("blob:")) {
    return "video";
  }
  return "unknown";
}

function estimateMediaAuthorizationBudget(input: {
  readonly mediaEvidenceRefs: readonly ConversationRuntimeMediaEvidenceRef[];
  readonly estimatedTokenBudget: ConversationRuntimeMediaAuthorizationRequest["estimatedTokenBudget"];
  readonly estimatedCostTier: ConversationRuntimeMediaAuthorizationCostTier;
}): ConversationRuntimeMediaAuthorizationRequest["budget"] {
  let videoSeconds = 0;
  let audioSeconds = 0;
  let videoCount = 0;
  let audioCount = 0;
  for (const evidence of input.mediaEvidenceRefs) {
    const mediaType = inferMediaEvidenceType(evidence);
    if (mediaType === "video") {
      videoCount += 1;
    } else if (mediaType === "audio") {
      audioCount += 1;
    }
    const durationSeconds = readRecordNumber(evidence.metadata, "durationSeconds");
    const durationMs = readRecordNumber(evidence.metadata, "durationMs");
    const duration = durationSeconds ?? (durationMs === undefined ? undefined : durationMs / 1000);
    if (duration === undefined || duration <= 0) {
      continue;
    }
    if (mediaType === "video") {
      videoSeconds += duration;
    } else if (mediaType === "audio") {
      audioSeconds += duration;
    }
  }
  return {
    tokenLimit: input.estimatedTokenBudget.deepMultimodal,
    fileCountLimit: input.mediaEvidenceRefs.length,
    videoMinuteLimit: Math.max(videoCount, Math.ceil(videoSeconds / 60)),
    audioMinuteLimit: Math.max(audioCount, Math.ceil(audioSeconds / 60)),
    estimatedCostTier: input.estimatedCostTier,
  };
}

function estimateMediaAuthorizationTokenBudget(input: {
  readonly image: number;
  readonly video: number;
  readonly audio: number;
  readonly unknown: number;
}): ConversationRuntimeMediaAuthorizationRequest["estimatedTokenBudget"] {
  const lowCost =
    input.image * 1_200 + input.video * 6_000 + input.audio * 3_000 + input.unknown * 1_500;
  const deepMultimodal =
    input.image * 4_000 + input.video * 24_000 + input.audio * 8_000 + input.unknown * 5_000;
  return {
    mediaInventory: 0,
    lowCost,
    deepMultimodal: Math.max(deepMultimodal, lowCost + 1_000),
  };
}

function estimateMediaAuthorizationCostTier(input: {
  readonly image: number;
  readonly video: number;
  readonly audio: number;
  readonly unknown: number;
}): ConversationRuntimeMediaAuthorizationCostTier {
  const assetCount = input.image + input.video + input.audio + input.unknown;
  if (assetCount === 0) {
    return "none";
  }
  if (input.video + input.audio >= 3 || assetCount >= 10) {
    return "high";
  }
  if (input.video > 0 || input.audio > 0 || assetCount >= 4) {
    return "medium";
  }
  return "low";
}

function promoteMediaAuthorizationCostTier(
  tier: ConversationRuntimeMediaAuthorizationCostTier,
): ConversationRuntimeMediaAuthorizationCostTier {
  if (tier === "none") {
    return "low";
  }
  if (tier === "low") {
    return "medium";
  }
  return "high";
}

function inferMediaAuthorizationPrivacy(
  mediaEvidenceRefs: readonly ConversationRuntimeMediaEvidenceRef[],
): ConversationRuntimeMemoryPrivacy {
  if (mediaEvidenceRefs.some((evidence) => evidence.privacy === "private")) {
    return "private";
  }
  if (mediaEvidenceRefs.some((evidence) => evidence.privacy !== "public")) {
    return "pii_potential";
  }
  return "public";
}

export function createLearningArtifact(
  input: CreateConversationRuntimeLearningArtifactInput,
): ConversationRuntimeLearningArtifact {
  const now = input.observedAtMs ?? Date.now();
  const qualityGates = createLearningArtifactQualityGates(input);
  const mediaAuthorizationRequest = createMediaAuthorizationRequest(input.mediaEvidenceRefs ?? []);
  const metadata = compactLearningRecord({
    ...(input.metadata ?? {}),
    ...(mediaAuthorizationRequest === undefined ? {} : { mediaAuthorizationRequest }),
  });
  const sessionKey = normalizeLearningSessionKey(input.sessionKey);
  const forcedQuarantine =
    input.classification?.roleRelevance === "off_scope" ||
    qualityGates.includes("source_not_publishable");
  const publishable =
    input.publishable ??
    (!forcedQuarantine && qualityGates.length === 0 && (input.confidence ?? "medium") !== "low");
  const status =
    input.status ??
    (forcedQuarantine
      ? "quarantined"
      : input.pendingConfirmationId
        ? "pending_confirmation"
        : "candidate");
  return {
    artifactId: input.artifactId,
    sessionKey,
    turnRunId: input.turnRunId,
    sourceSurface: input.sourceSurface,
    ...(input.angelRoleId === undefined ? {} : { angelRoleId: input.angelRoleId }),
    roleScope: {
      roleName: input.roleScope.roleName,
      domain: input.roleScope.domain,
      responsibilityTags: [...input.roleScope.responsibilityTags],
    },
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef,
    status,
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    mediaEvidenceRefs: [...(input.mediaEvidenceRefs ?? [])],
    confidence: input.confidence ?? inferArtifactConfidence(input),
    publishable,
    privacy: input.privacy ?? "pii_potential",
    ...(input.classification === undefined
      ? {}
      : {
          classification: {
            ...input.classification,
            tags: [...input.classification.tags],
            useCases: [...input.classification.useCases],
          },
        }),
    qualityGates,
    ...(input.pendingConfirmationId === undefined
      ? {}
      : { pendingConfirmationId: input.pendingConfirmationId }),
    createdAtMs: now,
    updatedAtMs: input.updatedAtMs ?? now,
    ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
  };
}

export function createLearningConfirmation(
  input: CreateConversationRuntimeLearningConfirmationInput,
): ConversationRuntimeLearningConfirmation {
  const createdAtMs = input.createdAtMs ?? Date.now();
  const sessionKey = normalizeLearningSessionKey(input.sessionKey);
  return {
    confirmationId: input.confirmationId,
    sessionKey,
    artifactId: input.artifactId,
    candidateIds: [...(input.candidateIds ?? [])],
    ...(input.conversationTurnId === undefined
      ? {}
      : { conversationTurnId: input.conversationTurnId }),
    status: input.status ?? "pending",
    createdAtMs,
    expiresAtMs: input.expiresAtMs ?? createdAtMs + (input.ttlMs ?? DEFAULT_CONFIRMATION_TTL_MS),
    ...(input.acceptedByMessageId === undefined
      ? {}
      : { acceptedByMessageId: input.acceptedByMessageId }),
    ...(input.decisionText === undefined ? {} : { decisionText: input.decisionText }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

export function resolveLearningConfirmationDecision(
  input: ResolveConversationRuntimeLearningConfirmationDecisionInput,
): ConversationRuntimeLearningConfirmationDecision {
  const nowMs = input.nowMs ?? Date.now();
  const pending = input.pending.find(
    (candidate) => candidate.sessionKey === input.sessionKey && candidate.status === "pending",
  );
  if (pending === undefined) {
    return { kind: "none" };
  }
  if (pending.expiresAtMs <= nowMs) {
    return {
      kind: "expired",
      confirmationId: pending.confirmationId,
      artifactId: pending.artifactId,
    };
  }
  if (isReadOnlyLearningEvidenceFollowup(input.text)) {
    return { kind: "none" };
  }
  const normalized = normalizeDecisionText(input.text);
  if (isLearningCollectionAdviceQuestion(input.text)) {
    return { kind: "none" };
  }
  const selectedCandidateIds = selectLearningConfirmationCandidateIds(
    input.text,
    pending.candidateIds,
  );
  if (selectedCandidateIds === "ordinal-out-of-range") {
    return { kind: "none", reason: "ordinal-out-of-range" };
  }
  if (isRejectDecisionText(normalized)) {
    return {
      kind: "reject",
      confirmationId: pending.confirmationId,
      artifactId: pending.artifactId,
      candidateIds: selectedCandidateIds,
      ...(input.messageId === undefined ? {} : { acceptedByMessageId: input.messageId }),
      decisionText: input.text,
    };
  }
  if (isAcceptDecisionText(input.text, normalized)) {
    return {
      kind: "accept",
      confirmationId: pending.confirmationId,
      artifactId: pending.artifactId,
      candidateIds: selectedCandidateIds,
      ...(input.messageId === undefined ? {} : { acceptedByMessageId: input.messageId }),
      decisionText: input.text,
    };
  }
  return { kind: "none" };
}

function orderPendingConfirmationsForResolution(
  confirmations: Iterable<ConversationRuntimeLearningConfirmation>,
  artifacts: Map<string, ConversationRuntimeLearningArtifact>,
  sessionKey: string,
): readonly ConversationRuntimeLearningConfirmation[] {
  return [...confirmations]
    .filter(
      (confirmation) => confirmation.sessionKey === sessionKey && confirmation.status === "pending",
    )
    .sort((left, right) => {
      const leftPinned =
        artifacts.get(left.artifactId)?.pendingConfirmationId === left.confirmationId;
      const rightPinned =
        artifacts.get(right.artifactId)?.pendingConfirmationId === right.confirmationId;
      if (leftPinned !== rightPinned) {
        return leftPinned ? -1 : 1;
      }
      if (left.createdAtMs !== right.createdAtMs) {
        return right.createdAtMs - left.createdAtMs;
      }
      if (left.expiresAtMs !== right.expiresAtMs) {
        return right.expiresAtMs - left.expiresAtMs;
      }
      return left.confirmationId.localeCompare(right.confirmationId);
    });
}

export function createLearningArtifactStore(
  options: CreateConversationRuntimeLearningArtifactStoreOptions = {},
): ConversationRuntimeLearningArtifactStore {
  const artifacts = new Map<string, ConversationRuntimeLearningArtifact>();
  const confirmations = new Map<string, ConversationRuntimeLearningConfirmation>();
  const nowMs = options.nowMs ?? (() => Date.now());

  for (const artifact of options.seed?.artifacts ?? []) {
    artifacts.set(artifact.artifactId, artifact);
  }
  for (const confirmation of options.seed?.confirmations ?? []) {
    confirmations.set(confirmation.confirmationId, confirmation);
  }

  function persist(): void {
    options.persist?.({
      schemaVersion: "conversation-runtime.learning-artifacts.v1",
      artifacts: [...artifacts.values()].sort((left, right) =>
        left.artifactId.localeCompare(right.artifactId),
      ),
      confirmations: [...confirmations.values()].sort((left, right) =>
        left.confirmationId.localeCompare(right.confirmationId),
      ),
    });
  }

  function setArtifact(
    artifact: ConversationRuntimeLearningArtifact,
  ): ConversationRuntimeLearningArtifact {
    artifacts.set(artifact.artifactId, cloneLearningArtifact(artifact));
    persist();
    return artifact;
  }

  function setConfirmation(
    confirmation: ConversationRuntimeLearningConfirmation,
  ): ConversationRuntimeLearningConfirmation {
    confirmations.set(confirmation.confirmationId, cloneLearningConfirmation(confirmation));
    persist();
    return confirmation;
  }

  return {
    upsertArtifact(artifact) {
      return setArtifact(artifact);
    },
    readArtifact(artifactId) {
      const artifact = artifacts.get(artifactId);
      return artifact === undefined ? undefined : cloneLearningArtifact(artifact);
    },
    listArtifacts(input = {}) {
      return [...artifacts.values()]
        .filter(
          (artifact) => input.sessionKey === undefined || artifact.sessionKey === input.sessionKey,
        )
        .filter((artifact) => input.status === undefined || artifact.status === input.status)
        .sort((left, right) => left.createdAtMs - right.createdAtMs)
        .map(cloneLearningArtifact);
    },
    upsertConfirmation(confirmation) {
      return setConfirmation(confirmation);
    },
    readConfirmation(confirmationId) {
      const confirmation = confirmations.get(confirmationId);
      return confirmation === undefined ? undefined : cloneLearningConfirmation(confirmation);
    },
    listPendingConfirmations(sessionKey, inputNowMs = nowMs()) {
      const normalizedSessionKey = normalizeLearningSessionKey(sessionKey);
      expirePendingConfirmations(confirmations, artifacts, inputNowMs);
      persist();
      return [...confirmations.values()]
        .filter(
          (confirmation) =>
            confirmation.sessionKey === normalizedSessionKey && confirmation.status === "pending",
        )
        .sort((left, right) => left.createdAtMs - right.createdAtMs)
        .map(cloneLearningConfirmation);
    },
    resolvePendingConfirmation(input) {
      const timestamp = input.nowMs ?? nowMs();
      const normalizedSessionKey = normalizeLearningSessionKey(input.sessionKey);
      expirePendingConfirmations(confirmations, artifacts, timestamp);
      const pendingForResolution = orderPendingConfirmationsForResolution(
        confirmations.values(),
        artifacts,
        normalizedSessionKey,
      );
      const decision = resolveLearningConfirmationDecision({
        text: input.text,
        sessionKey: normalizedSessionKey,
        pending: pendingForResolution,
        nowMs: timestamp,
        ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
      });
      if (decision.kind === "none") {
        persist();
        return { decision };
      }
      const confirmation = confirmations.get(decision.confirmationId);
      const artifact = artifacts.get(decision.artifactId);
      if (confirmation === undefined) {
        persist();
        return { decision };
      }
      const nextConfirmation = updateLearningConfirmationFromDecision(confirmation, decision);
      confirmations.set(nextConfirmation.confirmationId, nextConfirmation);
      let nextArtifact: ConversationRuntimeLearningArtifact | undefined;
      if (artifact !== undefined) {
        nextArtifact = updateLearningArtifactFromDecision(artifact, decision, timestamp);
        artifacts.set(nextArtifact.artifactId, nextArtifact);
      }
      persist();
      return {
        decision,
        ...(nextArtifact === undefined ? {} : { artifact: cloneLearningArtifact(nextArtifact) }),
        confirmation: cloneLearningConfirmation(nextConfirmation),
      };
    },
  };
}

export function createFileLearningArtifactStore(
  options: FileConversationRuntimeLearningArtifactStoreOptions,
): ConversationRuntimeLearningArtifactStore {
  return createLearningArtifactStore({
    ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
    seed: readLearningArtifactStoreDocument(options.path),
    persist: (document) => writeLearningArtifactStoreDocument(options.path, document),
  });
}

export function createPendingLearningArtifactFromResult(
  input: CreatePendingConversationRuntimeLearningArtifactFromResultInput,
): CreatePendingConversationRuntimeLearningArtifactFromResultResult {
  const resultRecord = isRecord(input.result) ? input.result : {};
  const providedRoleScope = input.roleScope ?? readLearningResultRoleScope(resultRecord);
  const roleScope = providedRoleScope ?? createDefaultLearningRoleScope();
  const roleScopeIsExplicit = providedRoleScope !== undefined;
  const resultMetadata = readLearningResultArtifactMetadata(resultRecord);
  const classification = inferPendingLearningArtifactClassification({
    result: resultRecord,
    roleScope,
    sourceRef: input.sourceRef,
    explicitRoleScope: roleScopeIsExplicit,
  });
  const candidateIds = extractLearningCandidateIds(resultRecord);
  const candidateSnapshots = extractLearningCandidateSnapshots(resultRecord, candidateIds);
  const candidateCount =
    readLearningResultNumber(resultRecord, "candidateCount") ?? candidateIds.length;
  const sourceEvidenceRefs = extractLearningSourceEvidenceRefs(resultRecord);
  const memoryEvidenceRecords = extractLearningMemoryEvidenceRecords(resultRecord);
  const evidenceSnapshots = extractLearningEvidenceSnapshots(resultRecord);
  const candidateEvidenceSnapshots = attachLearningEvidenceSnapshotsToCandidates(
    candidateSnapshots,
    evidenceSnapshots,
  );
  const mediaEvidenceRefs = extractLearningMediaEvidenceRefs(resultRecord, input.observedAtMs);
  const sourceBlocked = sourceEvidenceRefs.some(
    (evidence) =>
      evidence.publishable === false ||
      (typeof evidence.sourceAccessStatus === "string" &&
        evidence.sourceAccessStatus !== "available" &&
        evidence.sourceAccessStatus !== "unknown"),
  );
  const memoryBlocked = memoryEvidenceRecords.some(
    (evidence) =>
      typeof evidence.sourceAccessStatus === "string" &&
      evidence.sourceAccessStatus !== "available" &&
      evidence.sourceAccessStatus !== "unknown",
  );
  const hasUnverifiedMedia = mediaEvidenceRefs.some(
    (evidence) => !evidence.realVisualUnderstanding,
  );
  const roleOffScope = classification.roleRelevance === "off_scope";
  const canConfirm =
    candidateCount > 0 &&
    candidateIds.length > 0 &&
    !sourceBlocked &&
    !memoryBlocked &&
    !roleOffScope;
  const artifactId = `learning-artifact-${stableLearningSlug([
    input.sessionKey,
    input.sourceSurface,
    input.sourceKind,
    input.sourceRef,
    candidateIds.join(","),
  ])}`;
  const confirmationId = `learning-confirmation-${stableLearningSlug([
    input.sessionKey,
    artifactId,
  ])}`;
  const evidenceRefs = uniqueStrings([
    ...sourceEvidenceRefs.map((evidence) => evidence.id),
    ...memoryEvidenceRecords.map((evidence) => evidence.id),
  ]);
  const now = input.observedAtMs ?? Date.now();
  const automationAcceptance = createLearningAutomationAcceptance({
    action: input.automationAction,
    decision: input.automationDecision,
    canConfirm,
    hasUnverifiedMedia,
    artifactId,
    confirmationId,
    candidateIds,
  });
  const existingArtifact = input.store.readArtifact(artifactId);
  const existingConfirmation = input.store.readConfirmation(confirmationId);
  if (
    existingArtifact !== undefined &&
    existingConfirmation !== undefined &&
    existingConfirmation.status === "pending"
  ) {
    const mergedArtifact = mergeExistingPendingLearningArtifactEvidence({
      artifact: existingArtifact,
      evidenceRefs,
      mediaEvidenceRefs,
      metadata: {
        candidateCount,
        candidateIds,
        candidates: candidateEvidenceSnapshots,
        sourceEvidenceCount: sourceEvidenceRefs.length,
        memoryEvidenceCount: memoryEvidenceRecords.length,
        mediaEvidenceCount: mediaEvidenceRefs.length,
        evidenceSnapshots,
      },
      updatedAtMs: now,
    });
    if (mergedArtifact.updatedAtMs !== existingArtifact.updatedAtMs) {
      input.store.upsertArtifact(mergedArtifact);
    }
    return {
      created: false,
      artifact: mergedArtifact,
      confirmation: existingConfirmation,
      reason:
        mergedArtifact.updatedAtMs === existingArtifact.updatedAtMs
          ? "existing-pending"
          : "existing-pending-updated",
    };
  }
  const artifact = createLearningArtifact({
    artifactId,
    sessionKey: input.sessionKey,
    turnRunId: input.turnRunId,
    sourceSurface: input.sourceSurface,
    ...(input.angelRoleId === undefined ? {} : { angelRoleId: input.angelRoleId }),
    roleScope,
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef,
    evidenceRefs,
    mediaEvidenceRefs,
    classification,
    confidence: canConfirm && !hasUnverifiedMedia ? "high" : canConfirm ? "medium" : "low",
    publishable: canConfirm && !hasUnverifiedMedia,
    ...(canConfirm && automationAcceptance === undefined
      ? { pendingConfirmationId: confirmationId }
      : {}),
    ...(automationAcceptance === undefined ? {} : { status: "accepted" }),
    observedAtMs: now,
    metadata: compactLearningRecord({
      ...resultMetadata,
      ...(automationAcceptance === undefined ? {} : { autoPublish: false }),
      candidateCount,
      candidateIds,
      candidates: candidateEvidenceSnapshots,
      sourceEvidenceCount: sourceEvidenceRefs.length,
      memoryEvidenceCount: memoryEvidenceRecords.length,
      mediaEvidenceCount: mediaEvidenceRefs.length,
      evidenceSnapshots,
      textCandidateConfirmable: canConfirm,
      mediaContentConfirmable: !hasUnverifiedMedia,
      roleRelevance: classification.roleRelevance,
      roleMatchedTags: classification.tags,
      ...(automationAcceptance === undefined ? {} : { automationAcceptance }),
    }),
  });
  input.store.upsertArtifact(artifact);
  if (!canConfirm) {
    return {
      created: existingArtifact === undefined,
      artifact,
      reason: roleOffScope
        ? "role-scope-mismatch"
        : candidateCount <= 0 || candidateIds.length === 0
          ? "no-learning-candidates"
          : sourceBlocked || memoryBlocked
            ? "source-not-publishable"
            : "media-not-visually-analyzed",
    };
  }
  if (automationAcceptance !== undefined) {
    const confirmation = createLearningConfirmation({
      confirmationId,
      sessionKey: input.sessionKey,
      artifactId,
      candidateIds,
      conversationTurnId: input.turnRunId,
      status: "accepted",
      createdAtMs: now,
      acceptedByMessageId: "automation-policy",
      decisionText: automationAcceptance.reason,
      metadata: {
        automationPolicyId: automationAcceptance.automationPolicyId,
        automationMode: automationAcceptance.mode,
        autoResolvedReason: automationAcceptance.reason,
        riskLevel: automationAcceptance.riskLevel,
        riskLevelAllowed: automationAcceptance.riskLevelAllowed,
        rollback: automationAcceptance.rollback,
      },
    });
    input.store.upsertConfirmation(confirmation);
    return {
      created: existingArtifact === undefined || existingConfirmation === undefined,
      artifact,
      confirmation,
    };
  }
  const confirmation = createLearningConfirmation({
    confirmationId,
    sessionKey: input.sessionKey,
    artifactId,
    candidateIds,
    conversationTurnId: input.turnRunId,
    createdAtMs: now,
    ...(input.confirmationTtlMs === undefined ? {} : { ttlMs: input.confirmationTtlMs }),
  });
  input.store.upsertConfirmation(confirmation);
  return {
    created: existingArtifact === undefined || existingConfirmation === undefined,
    artifact,
    confirmation,
  };
}

export function createSourceAccessLimitedLearningArtifactFromRuntimeResult(
  input: CreateSourceAccessLimitedLearningArtifactFromRuntimeResultInput,
): CreatePendingConversationRuntimeLearningArtifactFromResultResult | undefined {
  if (input.result.memoryDecision?.action !== "candidate-review") {
    return undefined;
  }
  const allBlockedMemoryEvidence = (input.result.memoryEvidenceRecords ?? []).filter(
    (record) =>
      record.publishable === false &&
      record.sourceAccessStatus !== "available" &&
      record.sourceAccessStatus !== "unknown",
  );
  const sourceRef =
    input.sourceRef?.trim() ??
    allBlockedMemoryEvidence.flatMap(readMemoryEvidenceCanonicalSourceRefs)[0];
  if (sourceRef === undefined || sourceRef.length === 0) {
    return undefined;
  }
  const blockedMemoryEvidence = allBlockedMemoryEvidence.filter((record) =>
    memoryEvidenceReferencesSource(record, sourceRef),
  );
  if (blockedMemoryEvidence.length === 0) {
    return undefined;
  }
  const observedAtMs = input.observedAtMs ?? blockedMemoryEvidence[0]?.observedAtMs ?? Date.now();
  return createPendingLearningArtifactFromResult({
    store: input.store,
    sessionKey: input.sessionKey,
    turnRunId: input.result.turnRunId ?? input.result.turnId,
    sourceSurface: input.sourceSurface,
    sourceKind: input.sourceKind,
    sourceRef,
    observedAtMs,
    result: {
      result: {
        status: "degraded",
        candidateCount: 0,
        candidateIds: [],
      },
      memoryEvidenceRecords: blockedMemoryEvidence,
    },
  });
}

function memoryEvidenceReferencesSource(
  record: { readonly sourceRef: string; readonly metadata?: Readonly<Record<string, unknown>> },
  sourceRef: string,
): boolean {
  const normalized = sourceRef.toLocaleLowerCase();
  return readMemoryEvidenceCanonicalSourceRefs(record).some(
    (candidate) => candidate.toLocaleLowerCase() === normalized,
  );
}

function readMemoryEvidenceCanonicalSourceRefs(record: {
  readonly sourceRef: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}): readonly string[] {
  const candidates = [
    readRecordString(record.metadata, "sourceUrl"),
    readRecordString(record.metadata, "url"),
    readRecordString(record.metadata, "sourceRef"),
    record.sourceRef.startsWith("tool://") ? undefined : record.sourceRef,
  ].filter((item): item is string => item !== undefined);
  return uniqueStrings(candidates)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

interface ConversationRuntimeLearningAutomationAcceptance {
  readonly status: "accepted";
  readonly automationPolicyId: string;
  readonly mode?: string;
  readonly reason: string;
  readonly actionKind: string;
  readonly riskLevel: "low";
  readonly riskLevelAllowed?: string;
  readonly requiresAudit?: boolean;
  readonly rollback: {
    readonly kind: "learning-artifact-status";
    readonly artifactId: string;
    readonly confirmationId: string;
    readonly candidateIds: readonly string[];
    readonly restoreStatus: "pending_confirmation";
    readonly restoreConfirmationStatus: "pending";
  };
}

function createLearningAutomationAcceptance(input: {
  readonly action: ConversationRuntimeAutomationAction | undefined;
  readonly decision: ConversationRuntimeAutomationPolicyDecision | undefined;
  readonly canConfirm: boolean;
  readonly hasUnverifiedMedia: boolean;
  readonly artifactId: string;
  readonly confirmationId: string;
  readonly candidateIds: readonly string[];
}): ConversationRuntimeLearningAutomationAcceptance | undefined {
  if (
    !input.canConfirm ||
    input.hasUnverifiedMedia ||
    input.action?.riskLevel !== "low" ||
    input.decision?.status !== "allowed" ||
    input.decision.policyId === undefined
  ) {
    return undefined;
  }
  return {
    status: "accepted",
    automationPolicyId: input.decision.policyId,
    ...(input.decision.mode === undefined ? {} : { mode: input.decision.mode }),
    reason: input.decision.reason,
    actionKind: input.action.kind,
    riskLevel: "low",
    ...(input.decision.riskLevelAllowed === undefined
      ? {}
      : { riskLevelAllowed: input.decision.riskLevelAllowed }),
    ...(input.decision.requiresAudit === undefined
      ? {}
      : { requiresAudit: input.decision.requiresAudit }),
    rollback: {
      kind: "learning-artifact-status",
      artifactId: input.artifactId,
      confirmationId: input.confirmationId,
      candidateIds: [...input.candidateIds],
      restoreStatus: "pending_confirmation",
      restoreConfirmationStatus: "pending",
    },
  };
}

function createLearningArtifactQualityGates(
  input: Pick<
    CreateConversationRuntimeLearningArtifactInput,
    "classification" | "mediaEvidenceRefs" | "sourceKind" | "publishable" | "pendingConfirmationId"
  >,
): readonly string[] {
  const gates: string[] = [];
  if (input.classification?.roleRelevance === "off_scope") {
    gates.push("role_scope_mismatch");
  }
  if (
    input.mediaEvidenceRefs !== undefined &&
    input.mediaEvidenceRefs.length > 0 &&
    input.mediaEvidenceRefs.some((evidence) => !evidence.realVisualUnderstanding)
  ) {
    gates.push("media_not_visually_analyzed");
    gates.push("media_authorization_required");
  }
  if (
    input.publishable === false &&
    input.pendingConfirmationId === undefined &&
    input.classification?.roleRelevance !== "off_scope"
  ) {
    gates.push("source_not_publishable");
  }
  return [...new Set(gates)];
}

function createDefaultLearningRoleScope(): ConversationRuntimeLearningRoleScope {
  return {
    roleName: "Director Angel",
    domain: "影视制作",
    responsibilityTags: ["导演", "短剧", "分镜", "AI 制作"],
  };
}

function readLearningResultRoleScope(
  result: Readonly<Record<string, unknown>>,
): ConversationRuntimeLearningRoleScope | undefined {
  const metadata = readRecord(result, "metadata");
  const candidates = [
    readRecord(result, "roleScope"),
    readRecord(metadata, "roleScope"),
    readRecord(readRecord(result, "result"), "roleScope"),
  ];
  for (const candidate of candidates) {
    if (candidate === undefined) {
      continue;
    }
    const roleName =
      readRecordString(candidate, "roleName") ??
      readRecordString(candidate, "title") ??
      readRecordString(candidate, "name");
    const domain = readRecordString(candidate, "domain");
    const responsibilityTags = uniqueStrings([
      ...readLearningResultStringArray(candidate, "responsibilityTags"),
      ...readLearningResultStringArray(candidate, "learningScope"),
      ...readLearningResultStringArray(candidate, "focus"),
    ]);
    if (roleName !== undefined && domain !== undefined && responsibilityTags.length > 0) {
      return {
        roleName,
        domain,
        responsibilityTags,
      };
    }
  }
  return undefined;
}

function readLearningResultArtifactMetadata(
  result: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const metadata = readRecord(result, "metadata");
  if (metadata === undefined) {
    return {};
  }
  return compactLearningRecord({
    roleScopedScheduledLearning:
      typeof metadata.roleScopedScheduledLearning === "boolean"
        ? metadata.roleScopedScheduledLearning
        : undefined,
    roleId: readRecordString(metadata, "roleId"),
    learningScope: readLearningResultStringArray(metadata, "learningScope"),
    sourcePolicy: readRecord(metadata, "sourcePolicy"),
    triggerReason:
      readRecordString(metadata, "triggerReason") ?? readRecordString(metadata, "learningReason"),
    candidateOnly: typeof metadata.candidateOnly === "boolean" ? metadata.candidateOnly : undefined,
    autoPublish: typeof metadata.autoPublish === "boolean" ? metadata.autoPublish : undefined,
    memorySync: readRecordString(metadata, "memorySync"),
  });
}

function inferPendingLearningArtifactClassification(input: {
  readonly result: Readonly<Record<string, unknown>>;
  readonly roleScope: ConversationRuntimeLearningRoleScope;
  readonly sourceRef: string;
  readonly explicitRoleScope: boolean;
}): ConversationRuntimeLearningClassification {
  const candidateText = extractLearningCandidateText(input.result);
  const normalizedText = normalizeLearningRelevanceText(
    uniqueStrings([...candidateText, input.sourceRef]).join("\n"),
  );
  const roleTerms = uniqueStrings([
    input.roleScope.domain,
    input.roleScope.roleName,
    ...input.roleScope.responsibilityTags,
  ]);
  const matchedTags = roleTerms.filter((term) => learningRoleTermMatches(normalizedText, term));
  const roleRelevance = inferLearningRoleRelevance({
    explicitRoleScope: input.explicitRoleScope,
    matchedTagCount: matchedTags.length,
    candidateTextLength: normalizeLearningRelevanceText(candidateText.join("")).length,
  });
  const topic = inferLearningClassificationTopic(input.result, input.sourceRef);
  return {
    domain: roleRelevance === "off_scope" ? "未归入岗位范围" : input.roleScope.domain,
    topic,
    tags: matchedTags.length > 0 ? matchedTags : inferLearningCandidateTags(input.result),
    useCases:
      roleRelevance === "off_scope"
        ? ["隔离为岗位外资料，需人工重新判断后才可使用"]
        : ["作为岗位经验候选，人工确认后进入长期经验"],
    roleRelevance,
  };
}

function inferLearningRoleRelevance(input: {
  readonly explicitRoleScope: boolean;
  readonly matchedTagCount: number;
  readonly candidateTextLength: number;
}): ConversationRuntimeLearningRoleRelevance {
  if (input.matchedTagCount >= 2) {
    return "high";
  }
  if (input.matchedTagCount === 1) {
    return "medium";
  }
  if (input.explicitRoleScope && input.candidateTextLength >= 16) {
    return "off_scope";
  }
  return "low";
}

function extractLearningCandidateText(
  result: Readonly<Record<string, unknown>>,
): readonly string[] {
  const fields = [
    "title",
    "summary",
    "content",
    "text",
    "body",
    "fullBody",
    "full_body",
    "lesson",
    "description",
  ];
  const fragments: string[] = [];
  for (const record of [
    result,
    readRecord(result, "result"),
    readRecord(result, "metadata"),
    ...readLearningCandidates(result),
  ]) {
    if (record === undefined) {
      continue;
    }
    for (const field of fields) {
      const value = readRecordString(record, field);
      if (value !== undefined) {
        fragments.push(value);
      }
    }
    const metadata = readRecord(record, "metadata");
    if (metadata !== undefined) {
      for (const field of fields) {
        const value = readRecordString(metadata, field);
        if (value !== undefined) {
          fragments.push(value);
        }
      }
    }
  }
  return uniqueStrings(fragments.map((fragment) => fragment.trim()).filter(Boolean));
}

function inferLearningClassificationTopic(
  result: Readonly<Record<string, unknown>>,
  sourceRef: string,
): string {
  for (const record of [result, readRecord(result, "result"), ...readLearningCandidates(result)]) {
    const title = readRecordString(record, "title");
    if (title !== undefined) {
      return title;
    }
    const summary = readRecordString(record, "summary");
    if (summary !== undefined) {
      return truncateLearningTopic(summary);
    }
  }
  return truncateLearningTopic(sourceRef);
}

function inferLearningCandidateTags(result: Readonly<Record<string, unknown>>): readonly string[] {
  const tags = readLearningCandidates(result).flatMap((candidate) => [
    ...readLearningResultStringArray(candidate, "tags"),
    ...readLearningResultStringArray(readRecord(candidate, "metadata"), "tags"),
  ]);
  return uniqueStrings(tags).slice(0, 6);
}

function learningRoleTermMatches(normalizedText: string, rawTerm: string): boolean {
  const term = normalizeLearningRelevanceText(rawTerm);
  if (term.length === 0) {
    return false;
  }
  if (normalizedText.includes(term)) {
    return true;
  }
  const parts = splitLearningRoleTerm(rawTerm);
  return parts.length >= 2 && parts.every((part) => normalizedText.includes(part));
}

function splitLearningRoleTerm(rawTerm: string): readonly string[] {
  const normalized = rawTerm
    .split(/[\s,，、/|;；:：()（）[\]【】"'“”‘’]+/u)
    .map(normalizeLearningRelevanceText)
    .filter((part) => part.length >= 2);
  const compact = normalizeLearningRelevanceText(rawTerm);
  if (normalized.length > 0) {
    return uniqueStrings(normalized);
  }
  if (/[\p{Script=Han}]/u.test(compact) && compact.length >= 4) {
    const chunks: string[] = [];
    for (let index = 0; index < compact.length - 1; index += 2) {
      chunks.push(compact.slice(index, index + 2));
    }
    return uniqueStrings(chunks);
  }
  return compact.length > 0 ? [compact] : [];
}

function normalizeLearningRelevanceText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function truncateLearningTopic(value: string): string {
  const trimmed = value.trim().replace(/\s+/gu, " ");
  return trimmed.length <= 80 ? trimmed : `${trimmed.slice(0, 77)}...`;
}

function extractLearningCandidateIds(result: Readonly<Record<string, unknown>>): readonly string[] {
  return uniqueStrings([
    ...readLearningResultStringArray(result, "candidateIds"),
    ...readLearningResultStringArray(result, "candidate_ids"),
    ...readLearningResultStringArray(readRecord(result, "result"), "candidateIds"),
    ...readLearningResultStringArray(readRecord(result, "result"), "candidate_ids"),
    ...readLearningCandidates(result).flatMap((candidate) => {
      const id =
        readRecordString(candidate, "candidateId") ??
        readRecordString(candidate, "id") ??
        readRecordString(readRecord(candidate, "metadata"), "id");
      return id === undefined ? [] : [id];
    }),
  ]);
}

function extractLearningCandidateSnapshots(
  result: Readonly<Record<string, unknown>>,
  candidateIds: readonly string[],
): readonly Readonly<Record<string, unknown>>[] {
  const candidates = readLearningCandidates(result);
  const snapshots = candidates.flatMap((candidate, index) => {
    const candidateId =
      readRecordString(candidate, "candidateId") ??
      readRecordString(candidate, "id") ??
      readRecordString(readRecord(candidate, "metadata"), "id") ??
      candidateIds[index];
    if (candidateId === undefined) {
      return [];
    }
    const metadata = readRecord(candidate, "metadata");
    return [
      compactLearningRecord({
        candidateId,
        title: readRecordString(candidate, "title") ?? readRecordString(metadata, "title"),
        summary: readRecordString(candidate, "summary") ?? readRecordString(metadata, "summary"),
        content:
          readRecordString(candidate, "content") ??
          readRecordString(candidate, "body") ??
          readRecordString(metadata, "content") ??
          readRecordString(metadata, "body"),
        tags: uniqueStrings([
          ...readLearningResultStringArray(candidate, "tags"),
          ...readLearningResultStringArray(metadata, "tags"),
        ]),
      }),
    ];
  });
  if (snapshots.length > 0) {
    return snapshots;
  }
  return candidateIds.map((candidateId) => ({ candidateId }));
}

function readLearningCandidates(
  result: Readonly<Record<string, unknown>>,
): readonly Readonly<Record<string, unknown>>[] {
  const direct = readRecordArray(result, "candidates");
  if (direct.length > 0) {
    return direct;
  }
  const nested = readRecordArray(readRecord(result, "result"), "candidates");
  if (nested.length > 0) {
    return nested;
  }
  return readRecordArray(result, "experienceCandidates");
}

function extractLearningSourceEvidenceRefs(
  result: Readonly<Record<string, unknown>>,
): ReadonlyArray<{
  readonly id: string;
  readonly sourceAccessStatus?: string;
  readonly publishable?: boolean;
}> {
  return readRecordArray(result, "sourceEvidenceRefs").flatMap((item) => {
    const id = readRecordString(item, "id");
    const sourceAccessStatus = readRecordString(item, "sourceAccessStatus");
    if (id === undefined) {
      return [];
    }
    return [
      {
        id,
        ...(sourceAccessStatus === undefined ? {} : { sourceAccessStatus }),
        ...(typeof item.publishable === "boolean" ? { publishable: item.publishable } : {}),
      },
    ];
  });
}

function extractLearningMemoryEvidenceRecords(
  result: Readonly<Record<string, unknown>>,
): ReadonlyArray<{
  readonly id: string;
  readonly sourceAccessStatus?: string;
  readonly publishable?: boolean;
}> {
  return readRecordArray(result, "memoryEvidenceRecords").flatMap((item) => {
    const id = readRecordString(item, "id");
    const sourceAccessStatus = readRecordString(item, "sourceAccessStatus");
    if (id === undefined) {
      return [];
    }
    return [
      {
        id,
        ...(sourceAccessStatus === undefined ? {} : { sourceAccessStatus }),
        ...(typeof item.publishable === "boolean" ? { publishable: item.publishable } : {}),
      },
    ];
  });
}

function extractLearningEvidenceSnapshots(
  result: Readonly<Record<string, unknown>>,
): readonly Readonly<Record<string, unknown>>[] {
  const records = [
    ...readRecordArray(result, "sourceEvidenceRefs"),
    ...readRecordArray(result, "memoryEvidenceRecords"),
  ];
  return records.flatMap((record) => {
    const evidenceId = readRecordString(record, "id");
    if (evidenceId === undefined) {
      return [];
    }
    const metadata = readRecord(record, "metadata");
    const evidenceDisclosureSnapshot =
      readRecord(record, "evidenceDisclosureSnapshot") ??
      readRecord(metadata, "evidenceDisclosureSnapshot") ??
      readRecord(record, "evidence_disclosure") ??
      readRecord(metadata, "evidence_disclosure");
    const externalContentSnapshot =
      readRecord(record, "externalContentSnapshot") ??
      readRecord(metadata, "externalContentSnapshot") ??
      readRecord(record, "external_content") ??
      readRecord(metadata, "external_content");
    const contentRef = readRecord(record, "contentRef") ?? readRecord(metadata, "contentRef");
    if (
      evidenceDisclosureSnapshot === undefined &&
      externalContentSnapshot === undefined &&
      contentRef === undefined
    ) {
      return [];
    }
    return [
      compactLearningRecord({
        evidenceId,
        ...(evidenceDisclosureSnapshot === undefined ? {} : { evidenceDisclosureSnapshot }),
        ...(externalContentSnapshot === undefined ? {} : { externalContentSnapshot }),
        ...(contentRef === undefined ? {} : { contentRef }),
      }),
    ];
  });
}

function attachLearningEvidenceSnapshotsToCandidates(
  candidates: readonly Readonly<Record<string, unknown>>[],
  evidenceSnapshots: readonly Readonly<Record<string, unknown>>[],
): readonly Readonly<Record<string, unknown>>[] {
  if (evidenceSnapshots.length === 0) {
    return candidates;
  }
  const evidenceIds = evidenceSnapshots.flatMap((snapshot) => {
    const evidenceId = readRecordString(snapshot, "evidenceId");
    return evidenceId === undefined ? [] : [evidenceId];
  });
  return candidates.map((candidate) =>
    compactLearningRecord({
      ...candidate,
      evidenceIds,
      evidenceSnapshots,
    }),
  );
}

function extractLearningMediaEvidenceRefs(
  result: Readonly<Record<string, unknown>>,
  observedAtMs: number | undefined,
): readonly ConversationRuntimeMediaEvidenceRef[] {
  return readRecordArray(result, "mediaEvidenceRefs").flatMap((item) => {
    const id = readRecordString(item, "id");
    const sourceRef = readRecordString(item, "sourceRef");
    const status = readRecordMediaEvidenceStatus(item, "status");
    const confidence = readRecordMemoryConfidence(item, "confidence");
    const privacy = readRecordMemoryPrivacy(item, "privacy");
    if (id === undefined || sourceRef === undefined || status === undefined) {
      return [];
    }
    return [
      createMediaEvidenceRef({
        id,
        sourceRef,
        status,
        ...(confidence === undefined ? {} : { confidence }),
        ...(typeof item.publishable === "boolean" ? { publishable: item.publishable } : {}),
        ...(privacy === undefined ? {} : { privacy }),
        ...(observedAtMs === undefined ? {} : { observedAtMs }),
        ...(isRecord(item.metadata) ? { metadata: item.metadata } : {}),
      }),
    ];
  });
}

function mergeExistingPendingLearningArtifactEvidence(input: {
  readonly artifact: ConversationRuntimeLearningArtifact;
  readonly evidenceRefs: readonly string[];
  readonly mediaEvidenceRefs: readonly ConversationRuntimeMediaEvidenceRef[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly updatedAtMs: number;
}): ConversationRuntimeLearningArtifact {
  const evidenceRefs = uniqueStrings([...input.artifact.evidenceRefs, ...input.evidenceRefs]);
  const mediaEvidenceRefs = mergeLearningMediaEvidenceRefs(
    input.artifact.mediaEvidenceRefs,
    input.mediaEvidenceRefs,
  );
  const hasUnverifiedMedia = mediaEvidenceRefs.some(
    (evidence) => !evidence.realVisualUnderstanding,
  );
  const publishable = input.artifact.publishable && !hasUnverifiedMedia;
  const mediaAuthorizationRequest = createMediaAuthorizationRequest(mediaEvidenceRefs);
  const metadata = compactLearningRecord({
    ...(input.artifact.metadata ?? {}),
    ...input.metadata,
    mediaEvidenceCount: mediaEvidenceRefs.length,
    textCandidateConfirmable:
      input.artifact.metadata?.textCandidateConfirmable ??
      input.artifact.pendingConfirmationId !== undefined,
    mediaContentConfirmable: !hasUnverifiedMedia,
    ...(mediaAuthorizationRequest === undefined ? {} : { mediaAuthorizationRequest }),
  });
  const qualityGates = uniqueStrings([
    ...input.artifact.qualityGates,
    ...createLearningArtifactQualityGates({
      ...(input.artifact.classification === undefined
        ? {}
        : { classification: input.artifact.classification }),
      mediaEvidenceRefs,
      sourceKind: input.artifact.sourceKind,
      publishable,
      ...(input.artifact.pendingConfirmationId === undefined
        ? {}
        : { pendingConfirmationId: input.artifact.pendingConfirmationId }),
    }),
  ]);
  const unchanged =
    evidenceRefs.length === input.artifact.evidenceRefs.length &&
    mediaEvidenceRefs.length === input.artifact.mediaEvidenceRefs.length &&
    publishable === input.artifact.publishable &&
    qualityGates.length === input.artifact.qualityGates.length &&
    JSON.stringify(metadata) === JSON.stringify(input.artifact.metadata ?? {});
  if (unchanged) {
    return input.artifact;
  }
  return {
    ...input.artifact,
    evidenceRefs,
    mediaEvidenceRefs,
    publishable,
    qualityGates,
    updatedAtMs: input.updatedAtMs,
    ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
  };
}

function mergeLearningMediaEvidenceRefs(
  existing: readonly ConversationRuntimeMediaEvidenceRef[],
  incoming: readonly ConversationRuntimeMediaEvidenceRef[],
): readonly ConversationRuntimeMediaEvidenceRef[] {
  const byKey = new Map<string, ConversationRuntimeMediaEvidenceRef>();
  const order: string[] = [];
  for (const evidence of [...existing, ...incoming]) {
    const key = createLearningMediaEvidenceMergeKey(evidence);
    const previous = byKey.get(key);
    if (previous === undefined) {
      order.push(key);
      byKey.set(key, evidence);
      continue;
    }
    byKey.set(key, mergeLearningMediaEvidenceRef(previous, evidence));
  }
  return order.flatMap((key) => {
    const evidence = byKey.get(key);
    return evidence === undefined ? [] : [evidence];
  });
}

function createLearningMediaEvidenceMergeKey(
  evidence: ConversationRuntimeMediaEvidenceRef,
): string {
  const sourceRef = evidence.sourceRef.trim().toLocaleLowerCase();
  return sourceRef.length > 0 ? `source:${sourceRef}` : `id:${evidence.id}`;
}

function mergeLearningMediaEvidenceRef(
  previous: ConversationRuntimeMediaEvidenceRef,
  next: ConversationRuntimeMediaEvidenceRef,
): ConversationRuntimeMediaEvidenceRef {
  const preferred = previous.realVisualUnderstanding ? previous : next;
  const fallback = preferred === previous ? next : previous;
  return {
    ...fallback,
    ...preferred,
    realVisualUnderstanding: previous.realVisualUnderstanding || next.realVisualUnderstanding,
    publishable: previous.publishable === true || next.publishable === true,
    confidence: selectLearningMediaEvidenceConfidence(previous.confidence, next.confidence),
    metadata: compactLearningRecord({
      ...(previous.metadata ?? {}),
      ...(next.metadata ?? {}),
    }),
  };
}

function selectLearningMediaEvidenceConfidence(
  left: ConversationRuntimeMemoryConfidence,
  right: ConversationRuntimeMemoryConfidence,
): ConversationRuntimeMemoryConfidence {
  const rank: Record<ConversationRuntimeMemoryConfidence, number> = {
    unknown: 0,
    low: 0,
    medium: 1,
    high: 2,
  };
  return rank[right] > rank[left] ? right : left;
}

function readLearningResultNumber(
  result: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  return (
    readRecordNumber(result, key) ??
    readRecordNumber(readRecord(result, "result"), key) ??
    readRecordNumber(
      result,
      key.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`),
    )
  );
}

function readLearningResultStringArray(
  result: Readonly<Record<string, unknown>> | undefined,
  key: string,
): readonly string[] {
  if (result === undefined) {
    return [];
  }
  const value = result[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function readRecord(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const nested = value[key];
  return isRecord(nested) ? nested : undefined;
}

function readRecordArray(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): readonly Readonly<Record<string, unknown>>[] {
  if (value === undefined || !Array.isArray(value[key])) {
    return [];
  }
  return (value[key] as readonly unknown[]).filter(isRecord);
}

function readRecordString(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw = value[key];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function readRecordNumber(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw = value[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function readRecordMediaEvidenceStatus(
  value: Readonly<Record<string, unknown>>,
  key: string,
): ConversationRuntimeMediaEvidenceStatus | undefined {
  const raw = readRecordString(value, key);
  return raw === "listed_only" ||
    raw === "browser_visible" ||
    raw === "ocr_extracted" ||
    raw === "vision_analyzed" ||
    raw === "blocked"
    ? raw
    : undefined;
}

function readRecordMemoryConfidence(
  value: Readonly<Record<string, unknown>>,
  key: string,
): ConversationRuntimeMemoryConfidence | undefined {
  const raw = readRecordString(value, key);
  return raw === "high" || raw === "medium" || raw === "low" || raw === "unknown" ? raw : undefined;
}

function readRecordMemoryPrivacy(
  value: Readonly<Record<string, unknown>>,
  key: string,
): ConversationRuntimeMemoryPrivacy | undefined {
  const raw = readRecordString(value, key);
  return raw === undefined ? undefined : raw;
}

function stableLearningSlug(parts: readonly string[]): string {
  let hash = 2166136261;
  const text = parts.join("\n");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${slugifyLearningId(parts.join("-")).slice(0, 80)}-${(hash >>> 0).toString(36)}`;
}

function slugifyLearningId(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._-]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function compactLearningRecord(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === undefined || entry === null) {
        return false;
      }
      if (Array.isArray(entry)) {
        return entry.length > 0;
      }
      return true;
    }),
  );
}

function inferArtifactConfidence(
  input: Pick<
    CreateConversationRuntimeLearningArtifactInput,
    "mediaEvidenceRefs" | "classification"
  >,
): ConversationRuntimeMemoryConfidence {
  if (input.classification?.roleRelevance === "off_scope") {
    return "low";
  }
  if (
    input.mediaEvidenceRefs !== undefined &&
    input.mediaEvidenceRefs.length > 0 &&
    input.mediaEvidenceRefs.every((evidence) => evidence.realVisualUnderstanding)
  ) {
    return "medium";
  }
  if (input.mediaEvidenceRefs?.some((evidence) => !evidence.realVisualUnderstanding)) {
    return "low";
  }
  return "medium";
}

function normalizeDecisionText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/gu, "")
    .replace(/[。！？!?,，、；;：:]/gu, "");
}

function isRejectDecisionText(value: string): boolean {
  return /(别存|不要存|不存|别收录|不要收录|拒绝|算了|删掉|删除|不对|错了|没看懂|不要保存|别保存)/u.test(
    value,
  );
}

function isAcceptDecisionText(raw: string, normalized: string): boolean {
  if (looksLikeLearningDecisionQuestion(raw)) {
    return false;
  }
  if (isOrdinalPersistenceAcceptCommand(normalized)) {
    return true;
  }
  if (isShortAcceptDecisionText(normalized)) {
    return true;
  }
  return isExplicitAcceptDecisionText(normalized);
}

function selectLearningConfirmationCandidateIds(
  rawText: string,
  candidateIds: readonly string[],
): readonly string[] | "ordinal-out-of-range" {
  const normalized = candidateIds.map((id) => id.trim()).filter((id) => id.length > 0);
  const ordinal = parseLearningConfirmationOrdinal(rawText);
  if (ordinal === null) {
    return normalized;
  }
  const selected = normalized[ordinal - 1];
  return selected === undefined ? "ordinal-out-of-range" : [selected];
}

function parseLearningConfirmationOrdinal(rawText: string): number | null {
  const text = rawText.trim().replace(/\s+/gu, " ");
  const digitMatch = /第\s*([1-9]\d*)\s*(?:条|个|项|篇|则)?/u.exec(text);
  if (digitMatch?.[1] !== undefined) {
    return Number.parseInt(digitMatch[1], 10);
  }
  const chineseMatch = /第\s*([一二两三四五六七八九十])\s*(?:条|个|项|篇|则)?/u.exec(text);
  if (chineseMatch?.[1] === undefined) {
    return null;
  }
  return readLearningConfirmationChineseOrdinal(chineseMatch[1]);
}

function readLearningConfirmationChineseOrdinal(value: string): number | null {
  switch (value) {
    case "一":
      return 1;
    case "二":
    case "两":
      return 2;
    case "三":
      return 3;
    case "四":
      return 4;
    case "五":
      return 5;
    case "六":
      return 6;
    case "七":
      return 7;
    case "八":
      return 8;
    case "九":
      return 9;
    case "十":
      return 10;
    default:
      return null;
  }
}

function looksLikeLearningDecisionQuestion(value: string): boolean {
  const text = value.trim();
  if (text.length === 0) {
    return false;
  }
  return (
    /[?？]/u.test(text) ||
    /(?:吗|么)$/u.test(text) ||
    /(?:如果|假如|要是|为什么|为何|怎么|如何|能不能|能否|可不可以|可以不可以|可否|是不是|是否|哪些|哪里|什么|有用吗|值得吗|要不要|该不该|有没有必要)/u.test(
      text,
    )
  );
}

function isShortAcceptDecisionText(value: string): boolean {
  return /^(?:可以|可以的|好|好的|嗯|嗯嗯|行|行的|对|对的|确认|接受|通过|批准|保留|留下|ok|okay|就这个|就这样|没问题)$/iu.test(
    value,
  );
}

function isOrdinalPersistenceAcceptCommand(value: string): boolean {
  return (
    parseLearningConfirmationOrdinal(value) !== null &&
    /(?:保存|存起来|收录|入库|纳入|归档|记下来|记住|保留|留下|接受|通过|批准|确认)/u.test(value)
  );
}

function isExplicitAcceptDecisionText(value: string): boolean {
  if (isBarePersistenceAcceptCommand(value) || isCandidateReferencePersistenceCommand(value)) {
    return true;
  }
  const hasLearningReference = hasExplicitLearningReference(value);
  const hasCandidateReference = hasContextualCandidateReference(value);
  const hasPersistenceVerb = /(?:保存|存起来|收录|入库|纳入|归档|记下来|记住|保留|留下)/u.test(
    value,
  );
  if (hasPersistenceVerb && hasLearningReference) {
    return true;
  }
  if (
    (hasLearningReference || hasCandidateReference) &&
    /(?:记下来|记住|保留|留下|当经验|放进经验|以后用|以后复用|(?:以后|后续|下次).{0,24}(?:用|复用))/u.test(
      value,
    )
  ) {
    return true;
  }
  return (hasLearningReference || hasCandidateReference) && /(?:确认|接受|通过|批准)/u.test(value);
}

function isBarePersistenceAcceptCommand(value: string): boolean {
  return /^(?:保存|保存吧|保存一下|存起来|收录|收录吧|入库|纳入|归档|记下来|记住|保留|留下)$/u.test(
    value,
  );
}

function isCandidateReferencePersistenceCommand(value: string): boolean {
  return /^(?:就|把|请|帮我)?(?:刚才(?:那条|这个|这篇)?|这条|这个|这篇|该条|该篇|它)(?:内容|链接|资料|帖子|文章|经验|候选|学习结果|方法|规则)?(?:保存|保存一下|存起来|收录|入库|纳入|归档|记下来|记住|保留|留下)(?:吧|下来)?$/u.test(
    value,
  );
}

function hasExplicitLearningReference(value: string): boolean {
  return /(?:经验库|经验候选|经验|候选|学习结果|学到|刚才学|收录到|入库到|放进经验|当经验|长期记忆|知识库|帖子|推文|文章|资料|方法|规则|这个链接|这条链接|这篇内容|这条内容)/u.test(
    value,
  );
}

function hasContextualCandidateReference(value: string): boolean {
  return /(?:就这个|就这条|这条|这篇|刚才这个|刚才那条|刚才那篇|该条|该篇)/u.test(value);
}

function updateLearningConfirmationFromDecision(
  confirmation: ConversationRuntimeLearningConfirmation,
  decision: Exclude<ConversationRuntimeLearningConfirmationDecision, { readonly kind: "none" }>,
): ConversationRuntimeLearningConfirmation {
  if (decision.kind === "expired") {
    return {
      ...confirmation,
      status: "expired",
    };
  }
  return {
    ...confirmation,
    status: decision.kind === "accept" ? "accepted" : "rejected",
    ...(decision.acceptedByMessageId === undefined
      ? {}
      : { acceptedByMessageId: decision.acceptedByMessageId }),
    decisionText: decision.decisionText,
  };
}

function updateLearningArtifactFromDecision(
  artifact: ConversationRuntimeLearningArtifact,
  decision: Exclude<ConversationRuntimeLearningConfirmationDecision, { readonly kind: "none" }>,
  updatedAtMs: number,
): ConversationRuntimeLearningArtifact {
  if (decision.kind === "expired") {
    return {
      ...artifact,
      updatedAtMs,
    };
  }
  return {
    ...artifact,
    status: decision.kind === "accept" ? "accepted" : "rejected",
    updatedAtMs,
  };
}

function expirePendingConfirmations(
  confirmations: Map<string, ConversationRuntimeLearningConfirmation>,
  artifacts: Map<string, ConversationRuntimeLearningArtifact>,
  nowMs: number,
): void {
  for (const confirmation of confirmations.values()) {
    if (confirmation.status !== "pending" || confirmation.expiresAtMs > nowMs) {
      continue;
    }
    confirmations.set(confirmation.confirmationId, {
      ...confirmation,
      status: "expired",
    });
    const artifact = artifacts.get(confirmation.artifactId);
    if (artifact !== undefined) {
      artifacts.set(artifact.artifactId, {
        ...artifact,
        updatedAtMs: nowMs,
      });
    }
  }
}

function cloneLearningArtifact(
  artifact: ConversationRuntimeLearningArtifact,
): ConversationRuntimeLearningArtifact {
  return JSON.parse(JSON.stringify(artifact)) as ConversationRuntimeLearningArtifact;
}

function cloneLearningConfirmation(
  confirmation: ConversationRuntimeLearningConfirmation,
): ConversationRuntimeLearningConfirmation {
  return JSON.parse(JSON.stringify(confirmation)) as ConversationRuntimeLearningConfirmation;
}

function readLearningArtifactStoreDocument(
  path: string,
): ConversationRuntimeLearningArtifactStoreDocument {
  if (!existsSync(path)) {
    return createEmptyLearningArtifactStoreDocument();
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parseLearningArtifactStoreDocument(parsed);
  } catch {
    return createEmptyLearningArtifactStoreDocument();
  }
}

function writeLearningArtifactStoreDocument(
  path: string,
  document: ConversationRuntimeLearningArtifactStoreDocument,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}

function createEmptyLearningArtifactStoreDocument(): ConversationRuntimeLearningArtifactStoreDocument {
  return {
    schemaVersion: "conversation-runtime.learning-artifacts.v1",
    artifacts: [],
    confirmations: [],
  };
}

function parseLearningArtifactStoreDocument(
  value: unknown,
): ConversationRuntimeLearningArtifactStoreDocument {
  if (!isRecord(value) || value.schemaVersion !== "conversation-runtime.learning-artifacts.v1") {
    return createEmptyLearningArtifactStoreDocument();
  }
  return {
    schemaVersion: "conversation-runtime.learning-artifacts.v1",
    artifacts: Array.isArray(value.artifacts)
      ? value.artifacts.flatMap((artifact) =>
          isLearningArtifact(artifact) ? [cloneLearningArtifact(artifact)] : [],
        )
      : [],
    confirmations: Array.isArray(value.confirmations)
      ? value.confirmations.flatMap((confirmation) =>
          isLearningConfirmation(confirmation) ? [cloneLearningConfirmation(confirmation)] : [],
        )
      : [],
  };
}

function isLearningArtifact(value: unknown): value is ConversationRuntimeLearningArtifact {
  return (
    isRecord(value) &&
    typeof value.artifactId === "string" &&
    typeof value.sessionKey === "string" &&
    typeof value.turnRunId === "string" &&
    typeof value.sourceSurface === "string" &&
    typeof value.sourceKind === "string" &&
    typeof value.sourceRef === "string" &&
    isLearningArtifactStatus(value.status) &&
    isRecord(value.roleScope) &&
    Array.isArray(value.evidenceRefs) &&
    Array.isArray(value.mediaEvidenceRefs) &&
    typeof value.publishable === "boolean" &&
    Array.isArray(value.qualityGates) &&
    typeof value.createdAtMs === "number" &&
    typeof value.updatedAtMs === "number"
  );
}

function isLearningArtifactStatus(
  value: unknown,
): value is ConversationRuntimeLearningArtifactStatus {
  return (
    value === "collecting" ||
    value === "candidate" ||
    value === "pending_confirmation" ||
    value === "accepted" ||
    value === "published" ||
    value === "rejected" ||
    value === "quarantined"
  );
}

function isLearningConfirmation(value: unknown): value is ConversationRuntimeLearningConfirmation {
  return (
    isRecord(value) &&
    typeof value.confirmationId === "string" &&
    typeof value.sessionKey === "string" &&
    typeof value.artifactId === "string" &&
    Array.isArray(value.candidateIds) &&
    isLearningConfirmationStatus(value.status) &&
    typeof value.createdAtMs === "number" &&
    typeof value.expiresAtMs === "number"
  );
}

function isLearningConfirmationStatus(
  value: unknown,
): value is ConversationRuntimeLearningConfirmationStatus {
  return (
    value === "pending" ||
    value === "accepted" ||
    value === "rejected" ||
    value === "expired" ||
    value === "cancelled"
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
