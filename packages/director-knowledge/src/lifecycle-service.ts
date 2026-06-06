import {
  DIRECTOR_KNOWLEDGE_REVIEW_DECISION_SCHEMA_VERSION,
  DIRECTOR_KNOWLEDGE_ROLLBACK_RECORD_SCHEMA_VERSION,
  type DirectorKnowledgeCandidateDocument,
  type DirectorKnowledgeReviewDecision,
  type DirectorKnowledgeReviewDecisionStatus,
  type DirectorKnowledgeRollbackRecord,
} from "./evolution.js";
import type {
  FileKnowledgeStore,
  KnowledgePublishResult,
  KnowledgeReviewDecisionWriteResult,
  KnowledgeRollbackRecordWriteResult,
} from "./store.js";
import {
  DIRECTOR_KNOWLEDGE_PACK_SCHEMA_VERSION,
  type DirectorKnowledgePackDocument,
} from "./types.js";

export interface DirectorKnowledgeLifecycleStorePort {
  getCandidateDocument(packId: string): Promise<DirectorKnowledgeCandidateDocument | null>;
  getReviewDecision(packId: string): Promise<DirectorKnowledgeReviewDecision | null>;
  writeReviewDecision(
    decision: DirectorKnowledgeReviewDecision,
  ): Promise<KnowledgeReviewDecisionWriteResult>;
  getPublished(packId: string): Promise<DirectorKnowledgePackDocument | null>;
  publish(document: DirectorKnowledgePackDocument): Promise<KnowledgePublishResult>;
  getHistoryDocument(
    packId: string,
    version: number,
  ): Promise<DirectorKnowledgePackDocument | null>;
  writeRollbackRecord(
    record: DirectorKnowledgeRollbackRecord,
  ): Promise<KnowledgeRollbackRecordWriteResult>;
  deleteCandidate(packId: string): Promise<void>;
}

export interface ReviewDirectorKnowledgeCandidateInput {
  readonly packId: string;
  readonly decision: DirectorKnowledgeReviewDecisionStatus;
  readonly actor?: string;
  readonly note?: string;
  readonly now?: string;
}

export interface ReviewDirectorKnowledgeCandidateResult {
  readonly status: "ok" | "degraded";
  readonly candidate: DirectorKnowledgeCandidateDocument;
  readonly review: DirectorKnowledgeReviewDecision;
  readonly notes: readonly string[];
}

export interface PublishDirectorKnowledgeCandidateInput {
  readonly packId: string;
  readonly actor?: string;
  readonly note?: string;
  readonly now?: string;
}

export interface PublishDirectorKnowledgeCandidateResult {
  readonly status: "ok" | "degraded";
  readonly published: DirectorKnowledgePackDocument;
  readonly review: DirectorKnowledgeReviewDecision;
  readonly previousPublishedVersion: number | null;
  readonly notes: readonly string[];
}

export interface RollbackDirectorKnowledgeInput {
  readonly packId: string;
  readonly restoredFromVersion: number;
  readonly actor?: string;
  readonly note?: string;
  readonly now?: string;
}

export interface RollbackDirectorKnowledgeResult {
  readonly status: "ok" | "degraded";
  readonly published: DirectorKnowledgePackDocument;
  readonly rollback: DirectorKnowledgeRollbackRecord;
  readonly notes: readonly string[];
}

export class DirectorKnowledgeLifecycleService {
  public constructor(private readonly store: DirectorKnowledgeLifecycleStorePort) {}

  public async reviewCandidate(
    input: ReviewDirectorKnowledgeCandidateInput,
  ): Promise<ReviewDirectorKnowledgeCandidateResult> {
    const candidate = await this.requireCandidate(input.packId);
    const review = materializeDirectorKnowledgeReviewDecision(candidate, {
      decision: input.decision,
      ...(input.actor === undefined ? {} : { actor: input.actor }),
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    const written = await this.store.writeReviewDecision(review);

    return {
      status: written.status,
      candidate,
      review,
      notes: written.notes,
    };
  }

  public async publishReviewedCandidate(
    input: PublishDirectorKnowledgeCandidateInput,
  ): Promise<PublishDirectorKnowledgeCandidateResult> {
    const candidate = await this.requireCandidate(input.packId);
    const review = await this.requireAcceptedReview(candidate);
    const currentPublished = await this.store.getPublished(input.packId);
    const expectedBaseVersion = candidate.evolution.baseVersion;
    const currentBaseVersion = currentPublished?.metadata.version ?? null;

    if (currentBaseVersion !== expectedBaseVersion) {
      throw new Error(
        `Director knowledge candidate ${input.packId} is stale. Expected base version ${expectedBaseVersion ?? "none"}, received ${currentBaseVersion ?? "none"}.`,
      );
    }

    const published = materializeDirectorKnowledgePackFromCandidate(candidate, review, {
      ...(input.actor === undefined ? {} : { actor: input.actor }),
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    const publishedResult = await this.store.publish(published);
    const head = await this.store.getPublished(input.packId);

    if (publishedResult.status === "ok") {
      await this.store.deleteCandidate(input.packId);
    }

    return {
      status: publishedResult.status,
      published: head ?? published,
      review,
      previousPublishedVersion: currentBaseVersion,
      notes: publishedResult.notes,
    };
  }

  public async rollbackPublishedKnowledge(
    input: RollbackDirectorKnowledgeInput,
  ): Promise<RollbackDirectorKnowledgeResult> {
    const currentPublished = await this.store.getPublished(input.packId);
    if (!currentPublished) {
      throw new Error(`Unknown Director knowledge pack: ${input.packId}`);
    }

    const historical = await this.store.getHistoryDocument(input.packId, input.restoredFromVersion);
    if (!historical) {
      throw new Error(
        `Unknown Director knowledge history version ${input.restoredFromVersion} for ${input.packId}.`,
      );
    }

    const published = materializeDirectorKnowledgeRollbackHead(historical, {
      ...(input.actor === undefined ? {} : { actor: input.actor }),
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    const publishResult = await this.store.publish(published);
    const head = await this.store.getPublished(input.packId);
    const rollback = materializeDirectorKnowledgeRollbackRecord({
      packId: input.packId,
      currentVersionBefore: currentPublished.metadata.version,
      restoredFromVersion: input.restoredFromVersion,
      currentVersionAfter: head?.metadata.version ?? publishResult.version,
      ...(input.actor === undefined ? {} : { actor: input.actor }),
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    const rollbackWrite = await this.store.writeRollbackRecord(rollback);

    return {
      status: publishResult.status === "ok" && rollbackWrite.status === "ok" ? "ok" : "degraded",
      published: head ?? published,
      rollback,
      notes: [...publishResult.notes, ...rollbackWrite.notes],
    };
  }

  private async requireCandidate(packId: string): Promise<DirectorKnowledgeCandidateDocument> {
    const candidate = await this.store.getCandidateDocument(packId);
    if (!candidate) {
      throw new Error(`Unknown Director knowledge candidate: ${packId}`);
    }
    return candidate;
  }

  private async requireAcceptedReview(
    candidate: DirectorKnowledgeCandidateDocument,
  ): Promise<DirectorKnowledgeReviewDecision> {
    const review = await this.store.getReviewDecision(candidate.metadata.id);
    if (!review) {
      throw new Error(
        `Director knowledge candidate ${candidate.metadata.id} has not been reviewed yet.`,
      );
    }
    if (review.decision !== "accepted") {
      throw new Error(
        `Director knowledge candidate ${candidate.metadata.id} must be accepted before publish.`,
      );
    }
    if (review.candidateVersion !== candidate.metadata.version) {
      throw new Error(
        `Director knowledge candidate ${candidate.metadata.id} review is stale. Expected candidate v${candidate.metadata.version}, received v${review.candidateVersion}.`,
      );
    }
    return review;
  }
}

export function materializeDirectorKnowledgeReviewDecision(
  candidate: DirectorKnowledgeCandidateDocument,
  input: {
    readonly decision: DirectorKnowledgeReviewDecisionStatus;
    readonly actor?: string;
    readonly note?: string;
    readonly now?: string;
  },
): DirectorKnowledgeReviewDecision {
  return {
    schemaVersion: DIRECTOR_KNOWLEDGE_REVIEW_DECISION_SCHEMA_VERSION,
    packId: candidate.metadata.id,
    candidateVersion: candidate.metadata.version,
    decision: input.decision,
    decidedAt: input.now ?? new Date().toISOString(),
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    ...(input.note === undefined ? {} : { note: input.note }),
    baseVersion: candidate.evolution.baseVersion,
    nextVersion: candidate.evolution.nextVersion,
  };
}

export function materializeDirectorKnowledgePackFromCandidate(
  candidate: DirectorKnowledgeCandidateDocument,
  review: DirectorKnowledgeReviewDecision,
  input: {
    readonly actor?: string;
    readonly note?: string;
    readonly now?: string;
  } = {},
): DirectorKnowledgePackDocument {
  const publishedAt = input.now ?? new Date().toISOString();
  return {
    schemaVersion: DIRECTOR_KNOWLEDGE_PACK_SCHEMA_VERSION,
    metadata: {
      ...candidate.metadata,
    },
    stage: "published",
    method: {
      ...candidate.method,
      roles: [...candidate.method.roles],
      preferredAdapters: [...candidate.method.preferredAdapters],
      anchorIds: [...candidate.method.anchorIds],
    },
    audit: {
      publishedAt,
      ...(input.actor === undefined
        ? candidate.audit.author === undefined
          ? {}
          : { author: candidate.audit.author }
        : { author: input.actor }),
      ...(input.note === undefined
        ? candidate.audit.note === undefined
          ? {}
          : { note: candidate.audit.note }
        : { note: input.note }),
      sourceDecisionAt: review.decidedAt,
      ...(review.note === undefined ? {} : { sourceDecisionNote: review.note }),
    },
  };
}

export function materializeDirectorKnowledgeRollbackHead(
  historical: DirectorKnowledgePackDocument,
  input: {
    readonly actor?: string;
    readonly note?: string;
    readonly now?: string;
  } = {},
): DirectorKnowledgePackDocument {
  const publishedAt = input.now ?? new Date().toISOString();
  return {
    schemaVersion: DIRECTOR_KNOWLEDGE_PACK_SCHEMA_VERSION,
    metadata: {
      ...historical.metadata,
    },
    stage: "published",
    method: {
      ...historical.method,
      roles: [...historical.method.roles],
      preferredAdapters: [...historical.method.preferredAdapters],
      anchorIds: [...historical.method.anchorIds],
    },
    audit: {
      publishedAt,
      ...(input.actor === undefined
        ? historical.audit.author === undefined
          ? {}
          : { author: historical.audit.author }
        : { author: input.actor }),
      ...(input.note === undefined
        ? { note: `rollback from v${historical.metadata.version}` }
        : { note: input.note }),
      ...(historical.audit.sourceDecisionAt === undefined
        ? {}
        : { sourceDecisionAt: historical.audit.sourceDecisionAt }),
      ...(historical.audit.sourceDecisionNote === undefined
        ? {}
        : { sourceDecisionNote: historical.audit.sourceDecisionNote }),
    },
  };
}

export function materializeDirectorKnowledgeRollbackRecord(input: {
  readonly packId: string;
  readonly currentVersionBefore: number;
  readonly restoredFromVersion: number;
  readonly currentVersionAfter: number;
  readonly actor?: string;
  readonly note?: string;
  readonly now?: string;
}): DirectorKnowledgeRollbackRecord {
  return {
    schemaVersion: DIRECTOR_KNOWLEDGE_ROLLBACK_RECORD_SCHEMA_VERSION,
    packId: input.packId,
    currentVersionBefore: input.currentVersionBefore,
    restoredFromVersion: input.restoredFromVersion,
    currentVersionAfter: input.currentVersionAfter,
    rolledBackAt: input.now ?? new Date().toISOString(),
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    ...(input.note === undefined ? {} : { note: input.note }),
  };
}

export function createDirectorKnowledgeLifecycleService(
  store: FileKnowledgeStore,
): DirectorKnowledgeLifecycleService {
  return new DirectorKnowledgeLifecycleService(store);
}
