import type { SessionStore } from "@hotflow/sessions";
import {
  type ProposalRecord,
  SessionStoreTaskPlanePort,
  readCommittedSessionTaskSnapshot,
} from "@hotflow/tasks-core";

import { type BootstrapWorkerJobsOptions, bootstrapWorkerJobs } from "./bootstrap.js";
import { runTrajectorySummaryJob } from "./jobs/trajectory-summary.js";
import { resolveWorkerJobSessionStore } from "./session-store.js";

export interface RunOnceInput extends BootstrapWorkerJobsOptions {
  readonly sessionId: string;
  readonly turnId: string;
  readonly proposalId?: string;
  readonly proposalKind?: string;
  readonly provenance?: string;
  readonly now?: () => number;
  readonly sessionStore?: SessionStore;
}

export interface RunOnceReport {
  readonly status: "ok";
  readonly sessionId: string;
  readonly sourceSessionId: string;
  readonly sourceTurnId: string;
  readonly proposalId: string;
  readonly proposalKind: string;
  readonly proposalStatus: ProposalRecord["status"];
  readonly provenance: string;
  readonly proposalQueueDelta: number;
  readonly proposalOutboxDelta: number;
  readonly journalDelta: number;
  readonly snapshotJournalEvents: number;
  readonly snapshotTaskProposalQueue: number;
  readonly snapshotTaskProposalOutbox: number;
  readonly resultTaskProposalQueue: number;
  readonly resultTaskProposalOutbox: number;
  readonly checkpointSeq: number | null;
  readonly latestTurnId: string | null;
}

export async function runWorkerJobOnce(input: RunOnceInput): Promise<RunOnceReport> {
  const ownRuntime = input.sessionStore === undefined;
  const runtime = ownRuntime ? bootstrapWorkerJobs(input) : null;
  const sessionStore = resolveWorkerJobSessionStore(input.sessionStore, runtime);
  const proposalId = input.proposalId ?? `proposal_${(input.now ?? Date.now)()}`;
  const provenance = input.provenance ?? "worker-jobs/run-once";

  try {
    if (!sessionStore.getSession(input.sessionId)) {
      throw new Error(`Unknown session: ${input.sessionId}`);
    }

    const before = readCommittedSessionTaskSnapshot(sessionStore, input.sessionId);
    assertCommittedSnapshotIsSummarizable(before, input.sessionId);
    const taskPlane = new SessionStoreTaskPlanePort(sessionStore, input.sessionId, {
      createIfMissing: false,
    });

    const workerResult = runtime
      ? await runtime.jobs.trajectorySkillProposal({
          sessionId: input.sessionId,
          fallbackTurnId: input.turnId,
          proposalId,
          provenance,
        })
      : await runTrajectorySummaryJob(sessionStore, {
          sessionId: input.sessionId,
          fallbackTurnId: input.turnId,
          proposalId,
          provenance,
        });

    const after = readCommittedSessionTaskSnapshot(sessionStore, input.sessionId);
    const persistedProposal =
      (await taskPlane.getProposal(workerResult.proposalId)) ?? workerResult.proposal;

    return {
      status: "ok",
      sessionId: input.sessionId,
      sourceSessionId: input.sessionId,
      sourceTurnId: workerResult.sourceTurnId,
      proposalId: workerResult.proposalId,
      proposalKind: persistedProposal.kind,
      proposalStatus: persistedProposal.status,
      provenance,
      proposalQueueDelta:
        after.taskState.proposalQueue.length - before.taskState.proposalQueue.length,
      proposalOutboxDelta:
        after.taskState.proposalOutbox.length - before.taskState.proposalOutbox.length,
      journalDelta: after.journal.length - before.journal.length,
      snapshotJournalEvents: before.journal.length,
      snapshotTaskProposalQueue: before.taskState.proposalQueue.length,
      snapshotTaskProposalOutbox: before.taskState.proposalOutbox.length,
      resultTaskProposalQueue: after.taskState.proposalQueue.length,
      resultTaskProposalOutbox: after.taskState.proposalOutbox.length,
      checkpointSeq: before.checkpoint?.uptoSeq ?? null,
      latestTurnId: after.latestTurnId,
    };
  } finally {
    if (ownRuntime) {
      runtime?.close();
    }
  }
}

function assertCommittedSnapshotIsSummarizable(
  snapshot: ReturnType<typeof readCommittedSessionTaskSnapshot>,
  sessionId: string,
): void {
  if (snapshot.journal.length === 0) {
    throw new Error(`Session ${sessionId} has no committed snapshot.`);
  }

  if (snapshot.latestTurnId === null) {
    throw new Error(`Session ${sessionId} has no committed turn to summarize.`);
  }
}
