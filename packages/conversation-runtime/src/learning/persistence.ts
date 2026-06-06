import type { ConversationRuntimePromptKnowledgeBundle } from "../knowledge/repository.js";
import type { ConversationRuntimeLearningArtifact } from "../learning-artifact.js";
import {
  harvestLearningCandidate,
  readLearningCandidate,
  reviewLearningCandidate,
} from "./repository.js";

export interface RepositoryLearningPersistenceInput {
  readonly dataDir?: string;
  readonly input: {
    readonly text: string;
    readonly sessionKey: string;
    readonly channel: string;
    readonly surface: string;
    readonly messageId?: string;
  };
  readonly turnId: string;
  readonly decision: {
    readonly kind: "accept";
    readonly confirmationId: string;
    readonly artifactId: string;
    readonly candidateIds: readonly string[];
    readonly acceptedByMessageId?: string;
    readonly decisionText: string;
  };
  readonly artifact: ConversationRuntimeLearningArtifact;
  readonly confirmation: {
    readonly confirmationId: string;
    readonly sessionKey: string;
    readonly artifactId: string;
    readonly candidateIds: readonly string[];
    readonly status: string;
    readonly acceptedByMessageId?: string;
    readonly decisionText?: string;
  };
}

export interface RepositoryLearningPersistenceResult {
  readonly status: "candidate-accepted" | "candidate-confirmation-blocked" | "review-required";
  readonly candidateIds: readonly string[];
  readonly auditId: string;
  readonly message: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

interface LearningCandidateSnapshot {
  readonly candidateId: string;
  readonly title?: string | undefined;
  readonly summary?: string | undefined;
  readonly content?: string | undefined;
  readonly tags?: readonly string[] | undefined;
}

export async function persistAcceptedLearningConfirmationToRepository(
  input: RepositoryLearningPersistenceInput,
): Promise<RepositoryLearningPersistenceResult> {
  const candidateIds = [...input.decision.candidateIds];
  if (candidateIds.length === 0) {
    return {
      status: "candidate-confirmation-blocked",
      candidateIds: [],
      auditId: `learning-repository:${input.decision.confirmationId}`,
      message: "确认里没有绑定候选 ID，已 fail-closed。",
      metadata: { reason: "missing-candidate-ids" },
    };
  }

  for (const candidateId of candidateIds) {
    const bundle = buildKnowledgeBundleFromArtifact({
      artifact: input.artifact,
      confirmationId: input.confirmation.confirmationId,
      candidateId,
    });
    const existing = readLearningCandidate({
      itemId: bundle.itemId,
      revisionId: bundle.revisionId,
      ...(input.dataDir === undefined ? {} : { dataDir: input.dataDir }),
    });
    if (existing === null) {
      harvestLearningCandidate({
        bundle,
        actor: input.input.sessionKey,
        notes: [`Accepted by ${input.turnId}.`],
        ...(input.dataDir === undefined ? {} : { dataDir: input.dataDir }),
      });
    }
    reviewLearningCandidate({
      itemId: bundle.itemId,
      revisionId: bundle.revisionId,
      actor: input.input.sessionKey,
      notes: ["User confirmed this learning candidate for review."],
      ...(input.dataDir === undefined ? {} : { dataDir: input.dataDir }),
    });
  }

  return {
    status: "review-required",
    candidateIds,
    auditId: `learning-repository:${input.decision.confirmationId}`,
    message: "已进入待审经验候选，等待发布审核。",
    metadata: {
      confirmationId: input.confirmation.confirmationId,
      artifactId: input.artifact.artifactId,
      stage: "reviewed",
    },
  };
}

function buildKnowledgeBundleFromArtifact(input: {
  readonly artifact: ConversationRuntimeLearningArtifact;
  readonly confirmationId: string;
  readonly candidateId: string;
}): ConversationRuntimePromptKnowledgeBundle {
  const snapshot = findCandidateSnapshot(input.artifact, input.candidateId);
  const itemId = sanitizeKnowledgeId(input.candidateId);
  const revisionId = sanitizeKnowledgeId(input.artifact.turnRunId || input.artifact.artifactId);
  const title =
    snapshot?.title?.trim() ||
    input.artifact.classification?.topic ||
    `Learning candidate ${input.candidateId}`;
  const summary = snapshot?.summary?.trim() || snapshot?.content?.trim() || title;
  const tags = uniqueStrings([
    ...(snapshot?.tags ?? []),
    ...(input.artifact.classification?.tags ?? []),
  ]);

  return {
    bundleId: itemId,
    itemId,
    revisionId,
    title,
    description: summary,
    adapterId: "conversation-runtime-learning",
    modelAdapterId: "director-angel",
    executionProfileIds: ["director-angel-learning"],
    status: "draft",
    source: "external",
    tags,
    metadata: {
      sourceRef: input.artifact.sourceRef,
      sourceKind: input.artifact.sourceKind,
      sourceSurface: input.artifact.sourceSurface,
      artifactId: input.artifact.artifactId,
      confirmationId: input.confirmationId,
      candidateId: input.candidateId,
      roleRelevance: input.artifact.classification?.roleRelevance ?? "unknown",
      evidenceRefs: [...input.artifact.evidenceRefs],
      mediaEvidenceCount: input.artifact.mediaEvidenceRefs.length,
    },
    fieldSchema: [],
    layers: [
      {
        id: "source-evidence",
        label: "Source Evidence",
        category: "system",
        description: "Preserve source evidence and review boundaries.",
        directives: [`Source: ${input.artifact.sourceRef}`, `Candidate summary: ${summary}`],
      },
      {
        id: "reviewed-learning",
        label: "Reviewed Learning",
        category: "custom",
        description: "User-confirmed learning candidate awaiting publish review.",
        directives: [summary],
        tags,
      },
    ],
    defaultUserLayerIds: ["reviewed-learning"],
    inferenceRules: [],
    template: {
      header: title,
      body: summary,
    },
    publishedAt: new Date(input.artifact.createdAtMs).toISOString(),
  };
}

function findCandidateSnapshot(
  artifact: ConversationRuntimeLearningArtifact,
  candidateId: string,
): LearningCandidateSnapshot | undefined {
  const candidates = Array.isArray(artifact.metadata?.candidates)
    ? artifact.metadata.candidates
    : [];
  for (const raw of candidates) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }
    const record = raw as Record<string, unknown>;
    if (record.candidateId !== candidateId) {
      continue;
    }
    return {
      candidateId,
      title: typeof record.title === "string" ? record.title : undefined,
      summary: typeof record.summary === "string" ? record.summary : undefined,
      content: typeof record.content === "string" ? record.content : undefined,
      tags: Array.isArray(record.tags)
        ? record.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
    };
  }
  return undefined;
}

function sanitizeKnowledgeId(value: string): string {
  const sanitized = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._-]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
  return sanitized.length > 0 ? sanitized : "learning-candidate";
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
