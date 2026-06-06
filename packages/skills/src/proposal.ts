import type { ProposalQueueInput, ProposalRecord } from "@hotflow/contracts";

import type { SkillProposalDuplicateMatch, SkillProposalRiskLevel } from "./generator.js";
import { type SkillSnapshot, parseSkillSnapshot } from "./repository.js";

export const SKILL_SNAPSHOT_UPSERT_KIND = "skills.snapshot_upsert" as const;

export interface SkillProposalPayload extends Readonly<Record<string, unknown>> {
  readonly snapshot: SkillSnapshot;
  readonly trajectoryRef: string;
  readonly trigger?: string;
  readonly evidenceSummary?: string;
  readonly riskLevel?: SkillProposalRiskLevel;
  readonly confidence?: number;
  readonly dedupeKey?: string;
  readonly explanation?: string;
  readonly duplicateMatch?: SkillProposalDuplicateMatch;
}

export interface SkillProposal {
  readonly id: string;
  readonly kind: typeof SKILL_SNAPSHOT_UPSERT_KIND;
  readonly snapshot: SkillSnapshot;
  readonly sourceSessionId: string;
  readonly sourceTurnId: string;
  readonly trajectoryRef: string;
  readonly provenance: string;
  readonly trigger?: string;
  readonly evidenceSummary?: string;
  readonly riskLevel?: SkillProposalRiskLevel;
  readonly confidence?: number;
  readonly dedupeKey?: string;
  readonly explanation?: string;
  readonly duplicateMatch?: SkillProposalDuplicateMatch;
}

export interface CreateSkillProposalInput {
  readonly id: string;
  readonly snapshot: SkillSnapshot;
  readonly sourceSessionId: string;
  readonly sourceTurnId: string;
  readonly trajectoryRef: string;
  readonly provenance: string;
  readonly expiresAtMs?: number;
  readonly trigger?: string;
  readonly evidenceSummary?: string;
  readonly riskLevel?: SkillProposalRiskLevel;
  readonly confidence?: number;
  readonly dedupeKey?: string;
  readonly explanation?: string;
  readonly duplicateMatch?: SkillProposalDuplicateMatch;
}

export class SkillProposalStore {
  private readonly proposals = new Map<string, ProposalRecord>();

  public upsert(record: ProposalRecord): void {
    this.proposals.set(record.id, record);
  }

  public get(proposalId: string): ProposalRecord | undefined {
    return this.proposals.get(proposalId);
  }

  public list(): readonly ProposalRecord[] {
    return [...this.proposals.values()];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createSkillProposalQueueInput(input: CreateSkillProposalInput): ProposalQueueInput {
  return {
    id: input.id,
    kind: SKILL_SNAPSHOT_UPSERT_KIND,
    payload: encodeSkillProposalPayload({
      snapshot: input.snapshot,
      trajectoryRef: input.trajectoryRef,
      ...(input.trigger === undefined ? {} : { trigger: input.trigger }),
      ...(input.evidenceSummary === undefined ? {} : { evidenceSummary: input.evidenceSummary }),
      ...(input.riskLevel === undefined ? {} : { riskLevel: input.riskLevel }),
      ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
      ...(input.dedupeKey === undefined ? {} : { dedupeKey: input.dedupeKey }),
      ...(input.explanation === undefined ? {} : { explanation: input.explanation }),
      ...(input.duplicateMatch === undefined ? {} : { duplicateMatch: input.duplicateMatch }),
    }),
    sourceSessionId: input.sourceSessionId,
    sourceTurnId: input.sourceTurnId,
    provenance: input.provenance,
    ...(input.expiresAtMs === undefined ? {} : { expiresAtMs: input.expiresAtMs }),
  };
}

export function encodeSkillProposalPayload(
  proposal: Pick<
    SkillProposal,
    | "snapshot"
    | "trajectoryRef"
    | "trigger"
    | "evidenceSummary"
    | "riskLevel"
    | "confidence"
    | "dedupeKey"
    | "explanation"
    | "duplicateMatch"
  >,
): SkillProposalPayload {
  return {
    snapshot: {
      id: proposal.snapshot.id,
      version: proposal.snapshot.version,
      title: proposal.snapshot.title,
      content: proposal.snapshot.content,
      updatedAtMs: proposal.snapshot.updatedAtMs,
      ...(proposal.snapshot.description === undefined
        ? {}
        : { description: proposal.snapshot.description }),
      ...(proposal.snapshot.tags === undefined ? {} : { tags: [...proposal.snapshot.tags] }),
      ...(proposal.snapshot.toolNames === undefined
        ? {}
        : { toolNames: [...proposal.snapshot.toolNames] }),
      ...(proposal.snapshot.priority === undefined ? {} : { priority: proposal.snapshot.priority }),
      ...(proposal.snapshot.disableModelInvocation === undefined
        ? {}
        : { disableModelInvocation: proposal.snapshot.disableModelInvocation }),
      ...(proposal.snapshot.metadata === undefined
        ? {}
        : { metadata: { ...proposal.snapshot.metadata } }),
    },
    trajectoryRef: proposal.trajectoryRef,
    ...(proposal.trigger === undefined ? {} : { trigger: proposal.trigger }),
    ...(proposal.evidenceSummary === undefined
      ? {}
      : { evidenceSummary: proposal.evidenceSummary }),
    ...(proposal.riskLevel === undefined ? {} : { riskLevel: proposal.riskLevel }),
    ...(proposal.confidence === undefined ? {} : { confidence: proposal.confidence }),
    ...(proposal.dedupeKey === undefined ? {} : { dedupeKey: proposal.dedupeKey }),
    ...(proposal.explanation === undefined ? {} : { explanation: proposal.explanation }),
    ...(proposal.duplicateMatch === undefined
      ? {}
      : {
          duplicateMatch: {
            skillId: proposal.duplicateMatch.skillId,
            recommendation: proposal.duplicateMatch.recommendation,
            reason: proposal.duplicateMatch.reason,
            score: proposal.duplicateMatch.score,
          },
        }),
  };
}

export function decodeSkillProposal(record: ProposalRecord): SkillProposal | null {
  if (record.kind !== SKILL_SNAPSHOT_UPSERT_KIND) {
    return null;
  }

  const payload = record.payload;
  if (!isRecord(payload) || typeof payload.trajectoryRef !== "string") {
    return null;
  }
  if (payload.trigger !== undefined && typeof payload.trigger !== "string") {
    return null;
  }
  if (payload.evidenceSummary !== undefined && typeof payload.evidenceSummary !== "string") {
    return null;
  }
  if (
    payload.riskLevel !== undefined &&
    payload.riskLevel !== "low" &&
    payload.riskLevel !== "medium" &&
    payload.riskLevel !== "high"
  ) {
    return null;
  }
  if (
    payload.confidence !== undefined &&
    (typeof payload.confidence !== "number" ||
      !Number.isFinite(payload.confidence) ||
      payload.confidence < 0 ||
      payload.confidence > 1)
  ) {
    return null;
  }
  if (payload.dedupeKey !== undefined && typeof payload.dedupeKey !== "string") {
    return null;
  }
  if (payload.explanation !== undefined && typeof payload.explanation !== "string") {
    return null;
  }
  const parsedDuplicateMatch =
    payload.duplicateMatch === undefined ? undefined : parseDuplicateMatch(payload.duplicateMatch);
  if (payload.duplicateMatch !== undefined && parsedDuplicateMatch === null) {
    return null;
  }
  const duplicateMatch = parsedDuplicateMatch ?? undefined;

  const snapshot = parseSkillSnapshot(payload.snapshot);
  if (snapshot === null) {
    return null;
  }

  return {
    id: record.id,
    kind: SKILL_SNAPSHOT_UPSERT_KIND,
    snapshot,
    sourceSessionId: record.sourceSessionId,
    sourceTurnId: record.sourceTurnId,
    trajectoryRef: payload.trajectoryRef,
    provenance: record.provenance,
    ...(payload.trigger === undefined ? {} : { trigger: payload.trigger }),
    ...(payload.evidenceSummary === undefined ? {} : { evidenceSummary: payload.evidenceSummary }),
    ...(payload.riskLevel === undefined ? {} : { riskLevel: payload.riskLevel }),
    ...(payload.confidence === undefined ? {} : { confidence: payload.confidence }),
    ...(payload.dedupeKey === undefined ? {} : { dedupeKey: payload.dedupeKey }),
    ...(payload.explanation === undefined ? {} : { explanation: payload.explanation }),
    ...(duplicateMatch === undefined ? {} : { duplicateMatch }),
  };
}

function parseDuplicateMatch(value: unknown): SkillProposalDuplicateMatch | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.skillId !== "string" ||
    (value.recommendation !== "merge" && value.recommendation !== "skip") ||
    typeof value.reason !== "string" ||
    typeof value.score !== "number" ||
    !Number.isFinite(value.score)
  ) {
    return null;
  }

  return {
    skillId: value.skillId,
    recommendation: value.recommendation,
    reason: value.reason,
    score: value.score,
  };
}
