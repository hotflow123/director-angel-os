import {
  type ExperienceCandidate,
  type ExperiencePromotionRecord,
  type ExperienceReviewDecision,
  createExperiencePromotionRecord,
} from "@hotflow/contracts";

import {
  DIRECTOR_KNOWLEDGE_CANDIDATE_SCHEMA_VERSION,
  type DirectorKnowledgeCandidateDocument,
  type DirectorKnowledgeEvolutionOperation,
  diffDirectorKnowledgePack,
} from "./evolution.js";
import type {
  ExperiencePromotionMetadata,
  ExperiencePromotionMetadataResolver,
} from "./experience-taxonomy.js";
import type { KnowledgeCandidateWriteResult } from "./store.js";
import type {
  DirectorKnowledgePackDocument,
  DirectorKnowledgePackMethod,
  KnowledgePackMetadata,
} from "./types.js";

export interface MaterializeDirectorKnowledgeCandidateFromExperienceOptions {
  readonly currentPublished?: DirectorKnowledgePackDocument | null;
  readonly sourceReviewDecision?: ExperienceReviewDecision;
  readonly promotionMetadata?: ExperiencePromotionMetadata | null;
  readonly author?: string;
  readonly note?: string;
  readonly now?: string;
}

export interface ExperiencePromotionExperienceStorePort {
  getCandidate(candidateId: string): Promise<ExperienceCandidate | null>;
  listReviewDecisions(candidateId?: string): Promise<readonly ExperienceReviewDecision[]>;
  writePromotion(promotion: ExperiencePromotionRecord): Promise<{
    readonly status: "ok" | "degraded";
    readonly notes: readonly string[];
  }>;
}

export interface ExperiencePromotionKnowledgeStorePort {
  getPublished(packId: string): Promise<DirectorKnowledgePackDocument | null>;
  writeCandidate(
    document: DirectorKnowledgeCandidateDocument,
  ): Promise<KnowledgeCandidateWriteResult>;
}

export interface ExperiencePromotionServiceOptions {
  readonly experienceStore: ExperiencePromotionExperienceStorePort;
  readonly knowledgeStore: ExperiencePromotionKnowledgeStorePort;
  readonly metadataResolver?: ExperiencePromotionMetadataResolver;
  readonly taxonomyStore?: ExperiencePromotionMetadataResolver;
}

export interface PromoteAcceptedExperienceCandidateInput {
  readonly candidateId: string;
  readonly actor?: string;
  readonly note?: string;
  readonly now?: string;
}

export interface PromoteAcceptedExperienceCandidateResult {
  readonly status: "ok" | "degraded";
  readonly experienceCandidate: ExperienceCandidate;
  readonly knowledgeCandidate: DirectorKnowledgeCandidateDocument;
  readonly promotion: ExperiencePromotionRecord | null;
  readonly currentPublishedVersion: number | null;
  readonly notes: readonly string[];
}

export class ExperiencePromotionService {
  public constructor(private readonly options: ExperiencePromotionServiceOptions) {}

  public async promoteAcceptedExperienceCandidate(
    input: PromoteAcceptedExperienceCandidateInput,
  ): Promise<PromoteAcceptedExperienceCandidateResult> {
    const experienceCandidate = await this.options.experienceStore.getCandidate(input.candidateId);
    if (experienceCandidate === null) {
      throw new Error(`Unknown experience candidate: ${input.candidateId}`);
    }
    if (experienceCandidate.quality?.verdict === "quarantine") {
      throw new Error(
        `Experience candidate ${input.candidateId} failed the experience quality gate and cannot be promoted.`,
      );
    }

    const latestReview = selectLatestExperienceReview(
      await this.options.experienceStore.listReviewDecisions(input.candidateId),
    );
    if (latestReview?.decision !== "accepted") {
      throw new Error(
        `Experience candidate ${input.candidateId} requires the latest experience review to be accepted before promotion.`,
      );
    }

    const metadataResolver = this.options.metadataResolver ?? this.options.taxonomyStore;
    const promotionMetadata =
      (await metadataResolver?.resolveExperiencePromotionMetadata(experienceCandidate)) ?? null;
    const packId = createDirectorKnowledgePackIdFromExperience(experienceCandidate);
    const currentPublished = await this.options.knowledgeStore.getPublished(packId);
    const knowledgeCandidate = materializeDirectorKnowledgeCandidateFromExperience(
      experienceCandidate,
      {
        currentPublished,
        sourceReviewDecision: latestReview,
        promotionMetadata,
        ...(input.actor === undefined ? {} : { author: input.actor }),
        ...(input.note === undefined ? {} : { note: input.note }),
        ...(input.now === undefined ? {} : { now: input.now }),
      },
    );
    const candidateWrite = await this.options.knowledgeStore.writeCandidate(knowledgeCandidate);
    if (candidateWrite.status !== "ok") {
      return {
        status: "degraded",
        experienceCandidate,
        knowledgeCandidate,
        promotion: null,
        currentPublishedVersion: currentPublished?.metadata.version ?? null,
        notes: candidateWrite.notes,
      };
    }

    const promotedAtMs = toEpochMs(input.now);
    const promotion = createExperiencePromotionRecord({
      promotionId: `promotion_${slugify(input.candidateId)}_${promotedAtMs}`,
      candidateId: input.candidateId,
      promotedTo: "director-knowledge-candidate",
      promotedRef: `knowledge://candidate/${knowledgeCandidate.metadata.id}`,
      promotedAtMs,
      ...(input.actor === undefined ? {} : { actorId: input.actor }),
    });
    const promotionWrite = await this.options.experienceStore.writePromotion(promotion);

    return {
      status: promotionWrite.status,
      experienceCandidate,
      knowledgeCandidate,
      promotion: promotionWrite.status === "ok" ? promotion : null,
      currentPublishedVersion: currentPublished?.metadata.version ?? null,
      notes: [...candidateWrite.notes, ...promotionWrite.notes],
    };
  }
}

export function materializeDirectorKnowledgeCandidateFromExperience(
  candidate: ExperienceCandidate,
  options: MaterializeDirectorKnowledgeCandidateFromExperienceOptions = {},
): DirectorKnowledgeCandidateDocument {
  const candidateAt = options.now ?? new Date().toISOString();
  const currentPublished = options.currentPublished ?? null;
  const packId = createDirectorKnowledgePackIdFromExperience(candidate);

  if (currentPublished !== null && currentPublished.metadata.id !== packId) {
    throw new Error(
      `Current published Director knowledge pack does not match experience pack id: expected ${packId}, received ${currentPublished.metadata.id}.`,
    );
  }

  const operation: DirectorKnowledgeEvolutionOperation =
    currentPublished === null ? "create" : "update";
  const nextVersion = (currentPublished?.metadata.version ?? 0) + 1;
  const metadata: KnowledgePackMetadata = {
    id: packId,
    title: candidate.title,
    description: candidate.applicability,
    tags: buildExperienceKnowledgeTags(candidate, options.promotionMetadata ?? null),
    createdAt: candidateAt,
    ...(options.author === undefined ? {} : { author: options.author }),
    version: nextVersion,
  };
  const method = buildExperienceKnowledgeMethod(candidate, options.promotionMetadata ?? null);
  const diff = diffDirectorKnowledgePack(currentPublished, {
    metadata,
    method,
  });

  return {
    schemaVersion: DIRECTOR_KNOWLEDGE_CANDIDATE_SCHEMA_VERSION,
    metadata,
    stage: "candidate",
    method,
    audit: {
      candidateAt,
      ...(options.author === undefined ? {} : { author: options.author }),
      ...(options.note === undefined ? {} : { note: options.note }),
      ...(options.sourceReviewDecision === undefined
        ? {}
        : {
            sourceDecisionAt: new Date(options.sourceReviewDecision.decidedAtMs).toISOString(),
          }),
      ...(options.sourceReviewDecision?.note === undefined
        ? {}
        : { sourceDecisionNote: options.sourceReviewDecision.note }),
    },
    evolution: {
      operation,
      basePackId: currentPublished?.metadata.id ?? null,
      baseVersion: currentPublished?.metadata.version ?? null,
      nextVersion,
      dedupeKey: `experience:${candidate.sourceAdapter.adapterId}:${candidate.candidateId}`,
    },
    diff,
  };
}

export function createDirectorKnowledgePackIdFromExperience(
  candidate: Pick<ExperienceCandidate, "candidateId">,
): string {
  return `director-experience-${slugify(candidate.candidateId)}`;
}

function buildExperienceKnowledgeMethod(
  candidate: ExperienceCandidate,
  metadata: ExperiencePromotionMetadata | null = null,
): DirectorKnowledgePackMethod {
  return {
    sourceProposalId: `experience:${candidate.candidateId}`,
    sourceRecordId: candidate.sourceAdapter.adapterId,
    sourceDigestId: resolveExperienceDigestId(candidate),
    projectId: "experience-learning",
    groupId: metadata?.groupId ?? metadata?.categoryId ?? candidate.sourceAdapter.sourceKind,
    goal: candidate.applicability,
    trigger: candidate.applicability,
    summary: candidate.summary,
    explanation: buildExperienceExplanation(candidate),
    evidenceSummary: buildExperienceEvidenceSummary(candidate),
    roles: ["researcher"],
    preferredAdapters: [],
    anchorIds: candidate.evidence.map((entry) => entry.evidenceId),
    generationType: "self-learning",
    generationStyle: candidate.sourceAdapter.sourceKind,
  };
}

function buildExperienceKnowledgeTags(
  candidate: ExperienceCandidate,
  metadata: ExperiencePromotionMetadata | null = null,
): string[] {
  return dedupeStrings([
    "experience",
    "self-learning",
    `source:${candidate.sourceAdapter.sourceKind}`,
    `privacy:${candidate.privacy}`,
    `adapter:${candidate.sourceAdapter.adapterId}`,
    ...candidate.tags,
    ...(metadata?.tags ?? []),
    ...(metadata?.categoryId === undefined ? [] : [`category:${metadata.categoryId}`]),
    ...(metadata?.tagIds ?? []).map((tagId) => `user-tag:${tagId}`),
  ]);
}

function buildExperienceExplanation(candidate: ExperienceCandidate): string {
  const risks =
    candidate.risks.length === 0
      ? "Risks: (none recorded)"
      : `Risks: ${candidate.risks.join(" | ")}`;
  return [
    candidate.summary,
    `Applicability: ${candidate.applicability}`,
    risks,
    `Source: ${candidate.sourceAdapter.sourceKind} ${candidate.sourceAdapter.sourceRef}`,
    `Privacy: ${candidate.privacy}`,
    "Runtime injection: disabled until this knowledge candidate is reviewed and published.",
    `Provenance: ${candidate.provenance}`,
  ].join("\n");
}

function buildExperienceEvidenceSummary(candidate: ExperienceCandidate): string {
  if (candidate.evidence.length === 0) {
    return "No evidence references were captured.";
  }

  return candidate.evidence
    .map((entry) => {
      const location = [entry.sourceRef, entry.path, entry.span]
        .filter((value): value is string => value !== undefined && value.length > 0)
        .join("#");
      return `${entry.evidenceId}: ${entry.summary} (${location})`;
    })
    .join(" | ");
}

function resolveExperienceDigestId(candidate: ExperienceCandidate): string {
  const incremental = candidate.sourceAdapter.incremental;
  if (incremental?.fingerprint) {
    return incremental.fingerprint;
  }
  if (incremental?.cursor) {
    return incremental.cursor;
  }

  for (const evidence of candidate.evidence) {
    const digest = evidence.attributes?.digest;
    if (typeof digest === "string" && digest.length > 0) {
      return digest;
    }
  }

  return `experience:${candidate.candidateId}`;
}

function selectLatestExperienceReview(
  decisions: readonly ExperienceReviewDecision[],
): ExperienceReviewDecision | null {
  if (decisions.length === 0) {
    return null;
  }
  return (
    [...decisions].sort((left, right) => {
      return (
        right.decidedAtMs - left.decidedAtMs || right.decisionId.localeCompare(left.decisionId)
      );
    })[0] ?? null
  );
}

function toEpochMs(value: string | undefined): number {
  if (value === undefined) {
    return Date.now();
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return parsed;
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
  return normalized.length > 0 ? normalized : "experience";
}
