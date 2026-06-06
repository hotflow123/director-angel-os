import type { TrajectoryDigest } from "@hotflow/contracts";
import type { SessionStore } from "@hotflow/sessions";
import {
  type SkillSnapshot,
  createSkillProposalQueueInput,
  decodeSkillProposal,
  generateSkillProposalFromDigest,
} from "@hotflow/skills";
import {
  type ProposalOutboxEntry,
  type ProposalRecord,
  SessionStoreTaskPlanePort,
  readCommittedSessionTaskSnapshot,
} from "@hotflow/tasks-core";

import { buildTrajectoryDigestFromCommittedSnapshot } from "../learning/trajectory-digest.js";

export interface RunTrajectorySummaryJobInput {
  readonly sessionId: string;
  readonly fallbackTurnId?: string;
  readonly proposalId?: string;
  readonly provenance?: string;
  readonly approvedSkills?: readonly SkillSnapshot[];
}

export interface TrajectorySummaryJobResult {
  readonly sessionId: string;
  readonly sourceTurnId: string;
  readonly proposalId: string;
  readonly proposal: ProposalRecord;
  readonly outboxEntry: ProposalOutboxEntry;
  readonly decodedProposal: ReturnType<typeof decodeSkillProposal>;
  readonly digest: TrajectoryDigest;
  readonly snapshot: SkillSnapshot;
  readonly metrics: {
    readonly totalJournalEvents: number;
    readonly journalEventsSinceCheckpoint: number;
    readonly toolCallCount: number;
    readonly toolResultCount: number;
    readonly assistantOutputCount: number;
    readonly latestUserText: string | null;
    readonly toolNames: readonly string[];
  };
}

export async function runTrajectorySummaryJob(
  sessionStore: SessionStore,
  input: RunTrajectorySummaryJobInput,
): Promise<TrajectorySummaryJobResult> {
  const snapshot = readCommittedSessionTaskSnapshot(sessionStore, input.sessionId);
  const digest = buildTrajectoryDigestFromCommittedSnapshot(snapshot, {
    ...(input.fallbackTurnId === undefined ? {} : { fallbackTurnId: input.fallbackTurnId }),
  });
  const sourceTurnId = digest.sourceTurnId;

  const proposalId =
    input.proposalId ?? `proposal_${sanitizeToken(input.sessionId)}_${sanitizeToken(sourceTurnId)}`;
  const metrics = summarizeTrajectory(snapshot, digest);
  const generatedProposal = generateSkillProposalFromDigest({
    digest,
    approvedSkills: input.approvedSkills ?? [],
    provenance: input.provenance ?? "worker-jobs/trajectory-summary",
    metrics,
  });
  const port = new SessionStoreTaskPlanePort(sessionStore, input.sessionId, {
    createIfMissing: false,
  });
  const snapshotRecord = generatedProposal.snapshot;
  const nextState = await port.enqueueProposal(
    createSkillProposalQueueInput({
      id: proposalId,
      snapshot: snapshotRecord,
      sourceSessionId: input.sessionId,
      sourceTurnId,
      trajectoryRef: `journal://${input.sessionId}/${sourceTurnId}`,
      provenance: input.provenance ?? "worker-jobs/trajectory-summary",
      trigger: generatedProposal.trigger,
      evidenceSummary: generatedProposal.evidenceSummary,
      riskLevel: generatedProposal.riskLevel,
      confidence: generatedProposal.confidence,
      dedupeKey: generatedProposal.dedupeKey,
      explanation: generatedProposal.explanation,
      ...(generatedProposal.duplicateMatch === undefined
        ? {}
        : { duplicateMatch: generatedProposal.duplicateMatch }),
    }),
  );

  const proposal = nextState.proposalQueue.find((entry) => entry.id === proposalId);
  if (!proposal) {
    throw new Error(`Proposal ${proposalId} was not persisted.`);
  }
  const outboxEntry = nextState.proposalOutbox.find((entry) => entry.proposalId === proposalId);
  if (!outboxEntry) {
    throw new Error(`Proposal ${proposalId} outbox entry was not persisted.`);
  }

  return {
    sessionId: input.sessionId,
    sourceTurnId,
    proposalId,
    proposal,
    outboxEntry,
    decodedProposal: decodeSkillProposal(proposal),
    digest,
    snapshot: snapshotRecord,
    metrics,
  };
}

function summarizeTrajectory(
  snapshot: ReturnType<typeof readCommittedSessionTaskSnapshot>,
  digest: TrajectoryDigest,
) {
  return {
    totalJournalEvents: snapshot.journal.length,
    journalEventsSinceCheckpoint: snapshot.journal.filter(
      (entry) => entry.seq > (snapshot.checkpoint?.uptoSeq ?? 0),
    ).length,
    toolCallCount: digest.counts.toolCallCount,
    toolResultCount: digest.counts.toolResultCount,
    assistantOutputCount: digest.counts.assistantOutputCount,
    latestUserText: digest.latestUserText,
    toolNames: [...digest.toolNames],
  };
}

function sanitizeToken(value: string): string {
  return value.replace(/[^a-z0-9_]+/giu, "_");
}
