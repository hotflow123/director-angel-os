import {
  type DirectorKnowledgeCandidateDocument,
  materializeDirectorKnowledgeCandidateFromProposal,
} from "./evolution.js";
import type { KnowledgeCandidateWriteResult } from "./store.js";
import {
  type DirectorKnowledgeSourceProposal,
  materializeDirectorKnowledgePackFromProposal,
} from "./types.js";

export interface DirectorKnowledgeCandidateStorePort {
  getPublished(packId: string): Promise<import("./types.js").DirectorKnowledgePackDocument | null>;
  listCandidateDocuments?(): Promise<readonly DirectorKnowledgeCandidateDocument[]>;
  writeCandidate(
    document: DirectorKnowledgeCandidateDocument,
  ): Promise<KnowledgeCandidateWriteResult>;
}

export interface SyncDirectorKnowledgeCandidateInput {
  readonly proposal: DirectorKnowledgeSourceProposal;
  readonly author?: string;
  readonly note?: string;
  readonly now?: string;
}

export interface SyncDirectorKnowledgeCandidateResult extends KnowledgeCandidateWriteResult {
  readonly candidate: DirectorKnowledgeCandidateDocument;
  readonly currentPublishedVersion: number | null;
  readonly outcome: "written" | "skipped";
  readonly skipReason?: "duplicate-equivalent-published" | "duplicate-equivalent-candidate";
}

export class DirectorKnowledgeCandidateSyncService {
  public constructor(private readonly store: DirectorKnowledgeCandidateStorePort) {}

  public async syncAcceptedProposal(
    input: SyncDirectorKnowledgeCandidateInput,
  ): Promise<SyncDirectorKnowledgeCandidateResult> {
    const preview = materializeDirectorKnowledgePackFromProposal(input.proposal, {
      ...(input.author === undefined ? {} : { author: input.author }),
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    const currentPublished = await this.store.getPublished(preview.metadata.id);
    const candidate = materializeDirectorKnowledgeCandidateFromProposal(input.proposal, {
      currentPublished,
      ...(input.author === undefined ? {} : { author: input.author }),
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.now === undefined ? {} : { now: input.now }),
    });
    const currentPublishedVersion = currentPublished?.metadata.version ?? null;

    if (
      currentPublished !== null &&
      areRuntimeRelevantKnowledgeContentsEqual(candidate, currentPublished)
    ) {
      return {
        status: "ok",
        packId: candidate.metadata.id,
        version: candidate.metadata.version,
        notes: [
          `Skipped Director knowledge candidate ${candidate.metadata.id}: duplicate-equivalent-published.`,
          "Published knowledge already contains the same runtime-relevant method content; no version-only candidate was created.",
        ],
        candidate,
        currentPublishedVersion,
        outcome: "skipped",
        skipReason: "duplicate-equivalent-published",
      };
    }

    const sameKeyCandidates = await this.listSameKeyCandidates(candidate);
    const equivalentPending = sameKeyCandidates.find((existing) =>
      areRuntimeRelevantKnowledgeContentsEqual(candidate, existing),
    );
    if (equivalentPending !== undefined) {
      return {
        status: "ok",
        packId: equivalentPending.metadata.id,
        version: equivalentPending.metadata.version,
        notes: [
          `Skipped Director knowledge candidate ${candidate.metadata.id}: duplicate-equivalent-candidate.`,
          `Pending candidate ${equivalentPending.metadata.id} already contains the same runtime-relevant method content.`,
        ],
        candidate: equivalentPending,
        currentPublishedVersion,
        outcome: "skipped",
        skipReason: "duplicate-equivalent-candidate",
      };
    }

    const written = await this.store.writeCandidate(candidate);
    const duplicateNotes =
      sameKeyCandidates.length === 0
        ? []
        : [
            `Existing same-key candidate detected for ${candidate.evolution.dedupeKey}; stored a review-gated merge/update candidate instead of auto-publishing.`,
          ];

    return {
      ...written,
      notes: [...written.notes, ...duplicateNotes],
      candidate,
      currentPublishedVersion,
      outcome: "written",
    };
  }

  private async listSameKeyCandidates(
    candidate: DirectorKnowledgeCandidateDocument,
  ): Promise<readonly DirectorKnowledgeCandidateDocument[]> {
    const candidates = await this.store.listCandidateDocuments?.();
    if (candidates === undefined) {
      return [];
    }

    return candidates.filter(
      (existing) =>
        existing.metadata.id === candidate.metadata.id ||
        existing.evolution.dedupeKey === candidate.evolution.dedupeKey,
    );
  }
}

interface RuntimeRelevantKnowledgeContent {
  readonly metadata: {
    readonly title: string;
    readonly description: string | null;
    readonly tags: readonly string[];
  };
  readonly method: {
    readonly projectId: string;
    readonly groupId: string;
    readonly goal: string;
    readonly trigger: string;
    readonly summary: string;
    readonly explanation: string;
    readonly evidenceSummary: string;
    readonly roles: readonly string[];
    readonly preferredAdapters: readonly string[];
    readonly anchorIds: readonly string[];
    readonly generationType: string | null;
    readonly generationStyle: string | null;
  };
}

function areRuntimeRelevantKnowledgeContentsEqual(
  left: Pick<DirectorKnowledgeCandidateDocument, "metadata" | "method">,
  right: Pick<DirectorKnowledgeCandidateDocument, "metadata" | "method">,
): boolean {
  return (
    JSON.stringify(toRuntimeRelevantKnowledgeContent(left)) ===
    JSON.stringify(toRuntimeRelevantKnowledgeContent(right))
  );
}

function toRuntimeRelevantKnowledgeContent(
  document: Pick<DirectorKnowledgeCandidateDocument, "metadata" | "method">,
): RuntimeRelevantKnowledgeContent {
  return {
    metadata: {
      title: normalizeText(document.metadata.title),
      description: normalizeOptionalText(document.metadata.description),
      tags: normalizeStringSet(document.metadata.tags ?? []),
    },
    method: {
      projectId: normalizeText(document.method.projectId),
      groupId: normalizeText(document.method.groupId),
      goal: normalizeText(document.method.goal),
      trigger: normalizeText(document.method.trigger),
      summary: normalizeText(document.method.summary),
      explanation: normalizeText(document.method.explanation),
      evidenceSummary: normalizeText(document.method.evidenceSummary),
      roles: normalizeStringSet(document.method.roles),
      preferredAdapters: normalizeStringSet(document.method.preferredAdapters),
      anchorIds: normalizeStringSet(document.method.anchorIds),
      generationType: normalizeOptionalText(document.method.generationType),
      generationStyle: normalizeOptionalText(document.method.generationStyle),
    },
  };
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = value === undefined ? "" : normalizeText(value);
  return normalized.length === 0 ? null : normalized;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizeStringSet(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(normalizeText).filter((value) => value.length > 0))].sort(
    (left, right) => left.localeCompare(right),
  );
}
